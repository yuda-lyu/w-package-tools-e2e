import fs from 'fs'
import path from 'path'
import assert from 'assert'
import createServiceManager from '../src/createServiceManager.mjs'
import reserveE2ePorts, { getActiveE2ePortReservation } from '../src/reserveE2ePorts.mjs'
import { judgePortOwner, describePortOwners } from '../src/reapShardProcesses.mjs'
import { PORT_QUERY_TIMEOUT_MS } from '../src/listenerPids.mjs'
import { psOut, ok } from './tools/portPidsFake.mjs'


//就緒核對與 restart 查詢失敗之單元測試(規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E4、E5; 帳本 sgud/rule/rulebook_port.md R-15～R-20)。
//行程表與監聽者一律注入, 不碰真實埠與行程; 真實行程見 api-serviceOwner。


let PORT = 19800
let FAIL = { status: 1, stdout: '', error: new Error('查詢失敗(注入)') }


//注入之執行函數: script 為每輪 judge 依序取用之 { listeners, table }, 用完沿用最後一筆; listeners 為 null 即查詢失敗
function mkExec(script, calls = []) {
    let i = 0
    let cur = () => script[Math.min(i, script.length - 1)]
    return (prog, args, o) => {
        calls.push({ src: o.src, timeout: o.timeout })
        let s = cur()
        if (o.src === 'netstat') {
            return s.listeners ? ok(s.listeners.map((p) => `  TCP    127.0.0.1:${PORT}    0.0.0.0:0    LISTENING    ${p}\r\n`).join('')) : FAIL
        }
        if (o.src === 'powershell') {
            return s.listeners ? ok(psOut(s.listeners.map((p) => [PORT, '127.0.0.1', 0, p]))) : FAIL
        }
        if (o.src === 'table') {
            i++
            return s.table ? ok(s.table.map((r) => `${r.pid} ${r.ppid} ${new Date(r.startMs).toISOString()} ${r.image || 'x.exe'}`).join('\r\n')) : FAIL
        }
        if (o.src === 'tasklist') {
            return ok('"occupant.exe","1","Console","1","1 K"')
        }
        throw new Error(`未預期之 src: ${o.src}`)
    }
}


//監聽者查不到時不會取行程表, 由 judge 次數推進
function mkExecAdvanceOnListeners(script) {
    let i = 0
    return (prog, args, o) => {
        let s = script[Math.min(i, script.length - 1)]
        if (o.src === 'netstat') {
            return s.listeners ? ok(s.listeners.map((p) => `  TCP    127.0.0.1:${PORT}    0.0.0.0:0    LISTENING    ${p}\r\n`).join('')) : FAIL
        }
        if (o.src === 'powershell') {
            let r = s.listeners ? ok(psOut(s.listeners.map((p) => [PORT, '127.0.0.1', 0, p]))) : FAIL
            if (!s.listeners) {
                i++
            }
            return r
        }
        if (o.src === 'table') {
            i++
            return s.table ? ok(s.table.map((r) => `${r.pid} ${r.ppid} ${new Date(r.startMs).toISOString()} ${r.image || 'x.exe'}`).join('\r\n')) : FAIL
        }
        throw new Error(`未預期之 src: ${o.src}`)
    }
}


let row = (pid, ppid, startMs, image = 'node.exe') => ({ pid, ppid, startMs, image })
let TABLE = [row(100, 1, 5000, 'cmd.exe'), row(101, 100, 5100, 'node.exe'), row(102, 101, 5200, 'node.exe'), row(777, 1, 3000, 'occupant.exe')]
let alive = (pid) => ({ pid, exitCode: null, signalCode: null })


describe('就緒核對(judgePortOwner)', function() {

    let judge = (rootPid, listeners, table = TABLE, calls) => judgePortOwner(PORT, rootPid, { exec: mkExec([{ listeners, table }], calls), platform: 'win32' })

    //規格句: 確認該埠之監聽者是自建行程或其子孫
    it('[SU01] 監聽者是自建行程本身: own', function() {
        assert.strict.equal(judge(100, ['100']).result, 'own')
    })

    it('[SU02] 監聽者是存活子孫(shell:true 之 cmd → npm → node): own', function() {
        assert.strict.equal(judge(100, ['102']).result, 'own')
    })

    it('[SU03] 監聽者是他人: foreign, 寫明占用者之 PID 與映像名', function() {
        let r = judge(100, ['777'])
        assert.strict.equal(r.result, 'foreign')
        assert.strict.deepEqual(r.foreign, ['777'])
        assert.strict.ok(r.owners.includes('PID 777 occupant.exe'), r.owners)
    })

    //Windows 允許不同位址並存; 有他人在場連線就可能落到對方
    it('[SU04] 自建與他人並存: foreign, 訊息只列他人', function() {
        let r = judge(100, ['101', '777'])
        assert.strict.equal(r.result, 'foreign')
        assert.strict.deepEqual(r.foreign, ['777'])
        assert.strict.ok(!r.owners.includes('PID 101'), r.owners)
    })

    it('[SU05] 自建行程已結束(rootPid 為 null): 任何監聽者皆 foreign, 不因 PID 被回收而誤認', function() {
        assert.strict.equal(judge(null, ['100']).result, 'foreign')
        assert.strict.equal(judge(undefined, ['100']).result, 'foreign')
    })

    //launcher 先結束: 中間行程已死即斷鏈, 寧可拋錯也不把孤兒當自己人
    it('[SU06] 中間行程已結束(父不在行程表): foreign', function() {
        let table = [row(100, 1, 5000), row(102, 101, 5200)]
        assert.strict.equal(judge(100, ['102'], table).result, 'foreign')
    })

    it('[SU07] ppid 相同但起始早於父(PID 回收之假關係): foreign', function() {
        let table = [row(100, 1, 5000), row(102, 100, 4000)]
        assert.strict.equal(judge(100, ['102'], table).result, 'foreign')
    })

    it('[SU08] 根不在行程表: foreign', function() {
        assert.strict.equal(judge(999, ['100']).result, 'foreign')
    })

    it('[SU09] 查無監聽者: none, 不取行程表', function() {
        let calls = []
        let r = judge(100, [], TABLE, calls)
        assert.strict.equal(r.result, 'none')
        //訊息寫實際成因: 僅綁定未監聽之 socket; TIME_WAIT 實測不是成因(pe312 查實)
        assert.strict.ok(r.owners.includes('查無監聽者') && r.owners.includes('僅綁定未監聽'), r.owners)
        assert.strict.ok(!calls.some((c) => c.src === 'table'))
    })

    //null 代表查詢失敗, 不得當成無人或自己人
    it('[SU10] 監聽者查詢失敗: query-failed, 不是 none', function() {
        let r = judge(100, null)
        assert.strict.equal(r.result, 'query-failed')
        assert.strict.equal(r.listeners, null)
    })

    it('[SU11] 行程表查詢失敗: query-failed, 不是 own 也不是 foreign', function() {
        let r = judge(100, ['100'], null)
        assert.strict.equal(r.result, 'query-failed')
        assert.strict.ok(r.owners.includes('PID 100') && r.owners.includes('身分未知'), r.owners)
    })

    it('[SU12] 先查監聽者再取行程表(查得之監聽者若存活必在表內); 每個查詢都用共用逾時且 useBoth', function() {
        let calls = []
        judge(100, ['100'], TABLE, calls)
        assert.strict.deepEqual(calls.map((c) => c.src), ['netstat', 'powershell', 'table'], '有 powershell＝useBoth:true')
        assert.strict.deepEqual(calls.map((c) => c.timeout), [PORT_QUERY_TIMEOUT_MS, PORT_QUERY_TIMEOUT_MS, PORT_QUERY_TIMEOUT_MS])
    })

    it('[SU13] 監聽者已不在行程表: foreign, 訊息寫明', function() {
        let r = judge(100, ['555'])
        assert.strict.equal(r.result, 'foreign')
        assert.strict.ok(r.owners.includes('PID 555 (已不在行程表)'), r.owners)
    })

    //查埠逾時(派工第 5 項): 高負載下 PowerShell 啟動本身要數秒, 不可再因此回 null
    it('[SU14] describePortOwners 用共用逾時; 共用逾時長於實測之最長(CPU 4 倍超載之查埠 25.5 秒、CPU 2 倍超載退回舊查法之行程表 35 秒)', function() {
        let calls = []
        describePortOwners(PORT, { exec: mkExec([{ listeners: ['777'], table: TABLE }], calls) })
        assert.strict.equal(calls.find((c) => c.src === 'powershell').timeout, PORT_QUERY_TIMEOUT_MS)
        assert.strict.ok(PORT_QUERY_TIMEOUT_MS >= 40000, String(PORT_QUERY_TIMEOUT_MS))
    })

    it('[SU15] src 內查埠不再寫死逾時字面值(靜態守門)', function() {
        for (let f of fs.readdirSync('src').filter((v) => v.endsWith('.mjs'))) {
            let lines = fs.readFileSync(path.join('src', f), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\*|^\s*\/\//.test(l))
            for (let l of lines.filter((v) => v.includes('listenerPids('))) {
                assert.strict.ok(!/timeout:\s*\d/.test(l), `${f} 仍以字面值傳查埠逾時: ${l.trim()}`)
            }
        }
    })

})


describe('就緒核對(createServiceManager)', function() {

    //未導入路徑(reservation:null)會落到本行程之保留: 前面之測試不得殘留
    before(function() {
        assert.strict.equal(getActiveE2ePortReservation(), null, '前面之測試殘留保留')
    })

    let mkSm = (exec, over = {}) => {
        let st = { kills: [], noted: [], spawns: 0, foreignKills: [], logs: [], child: alive(100) }
        let sm = createServiceManager({
            failureMode: over.failureMode || 'once',
            exec,
            pollMs: 1,
            ownerRetryMs: 1,
            portReleaseTimeoutMs: 5,
            portReleasePollMs: 1,
            sleep: async () => {},
            probe: over.probe || (async () => st.spawns > 0),
            killTree: (c) => st.kills.push(c),
            killListeners: (p) => {
                st.foreignKills.push(p)
                return { pids: [], killed: [] }
            },
            reservation: over.reservation === undefined ? { source: 'auto', noteOwn: (c) => st.noted.push(c), killOwnListeners: () => ({ pids: [], killed: [], skipped: [] }) } : over.reservation,
            log: (s) => st.logs.push(s),
            killForeignOnRestart: !!over.killForeignOnRestart,
            verifyOwner: over.verifyOwner,
            services: [{
                name: 'svc',
                port: PORT,
                readyTimeoutMs: 50,
                spawn: () => {
                    st.spawns++
                    return st.child
                },
            }],
        })
        return { sm, st }
    }

    it('[SU20] 監聽者為自建: 放行, 之後才記入預約(noteOwn)', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['100'], table: TABLE }]))
        await sm.startServersOnce()
        assert.strict.deepEqual(st.noted, [st.child])
        assert.strict.equal(sm.state('svc').owned, true)
        assert.strict.deepEqual(st.kills, [])
    })

    //偵測與綁定之間被搶走、vue-cli 靜默改埠: 兩者都是占用者回應探測
    it('[SU21] 監聽者為他人: 拋 E2E_PORT_NOT_OWN 寫明埠與占用者; 只收自建, 不依埠下殺、不記入預約', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]))
        await assert.rejects(sm.startServersOnce(), (err) => {
            assert.strict.equal(err.code, 'E2E_PORT_NOT_OWN')
            assert.strict.equal(err.port, PORT)
            assert.ok(err.message.includes(`埠 ${PORT}`), err.message)
            assert.ok(err.message.includes('PID 777 occupant.exe'), err.message)
            assert.ok(err.message.includes('不下殺'), err.message)
            return true
        })
        assert.strict.deepEqual(st.kills, [st.child], '只收掉自建之服務')
        assert.strict.deepEqual(st.foreignKills, [], '不依埠下殺')
        assert.strict.deepEqual(st.noted, [], '未確認者不記入預約')
        assert.strict.equal(sm.state('svc').owned, false)
    })

    it('[SU22] 他人只是片刻(他人之 portfinder 試綁定、舊實例結束中): 重試後放行', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['777', '100'], table: TABLE }, { listeners: ['100'], table: TABLE }]))
        await sm.startServersOnce()
        assert.strict.deepEqual(st.noted, [st.child])
    })

    it('[SU22b] 共試 3 次才判定他人: 前兩次他人、第三次自建仍放行', async function() {
        let { sm } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }, { listeners: ['777'], table: TABLE }, { listeners: ['100'], table: TABLE }]))
        await sm.startServersOnce()
    })

    it('[SU23] 查詢失敗後恢復: 重試後放行', async function() {
        let { sm, st } = mkSm(mkExecAdvanceOnListeners([{ listeners: null }, { listeners: null }, { listeners: ['100'], table: TABLE }]))
        await sm.startServersOnce()
        assert.strict.deepEqual(st.noted, [st.child])
    })

    //明確處置: 仍查不到就不視為就緒, 不當成自己人
    it('[SU24] 監聽者一直查不到: 拋 E2E_PORT_OWNER_UNKNOWN, 收自建', async function() {
        let { sm, st } = mkSm(mkExecAdvanceOnListeners([{ listeners: null }]))
        await assert.rejects(sm.startServersOnce(), (err) => {
            assert.strict.equal(err.code, 'E2E_PORT_OWNER_UNKNOWN')
            assert.ok(err.message.includes('無法確認監聽者身分') && err.message.includes('試了 3 次'), err.message)
            return true
        })
        assert.strict.deepEqual(st.kills, [st.child])
        assert.strict.deepEqual(st.noted, [])
    })

    it('[SU24b] 行程表一直查不到: 同樣 E2E_PORT_OWNER_UNKNOWN', async function() {
        let { sm } = mkSm(mkExec([{ listeners: ['100'], table: null }]))
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_OWNER_UNKNOWN')
    })

    it('[SU25] 探測有回應而查無監聽者: 拋 E2E_PORT_NOT_OWN, 訊息寫查無監聽者', async function() {
        let { sm } = mkSm(mkExec([{ listeners: [], table: TABLE }]))
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN' && err.message.includes('查無監聽者'))
    })

    it('[SU26] 自建已結束(綁定失敗): 即使 PID 被回收且監聽也不算自己人, 訊息寫離開碼', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['100'], table: TABLE }]))
        st.child = { pid: 100, exitCode: 3, signalCode: null }
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN' && err.message.includes('已結束(離開碼 3)'))
    })

    it('[SU27] spawn 未取得行程(無 pid): 不放行, 訊息寫明', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]))
        st.child = {}
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN' && err.message.includes('自建行程未啟動'))
    })

    //pinned: 手動鎖埠沿用既有服務之語意照舊
    it('[SU28] 沿用既有服務(未 spawn): 不核對; pinned、inherited、未導入皆然', async function() {
        for (let reservation of [{ source: 'pinned', noteOwn: () => {} }, { source: 'inherited', noteOwn: () => {} }, null]) {
            let calls = []
            let { sm, st } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }], calls), { reservation, probe: async () => true })
            await sm.startServersOnce()
            assert.strict.equal(st.spawns, 0)
            assert.strict.deepEqual(calls, [], '不查監聽者')
        }
    })

    it('[SU29] 未導入 reserveE2ePorts 者(有 spawn)同樣核對', async function() {
        let { sm } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]), { reservation: null })
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN')
    })

    it('[SU30] restart 之新服務同樣核對: 不符拋錯、收自建', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]))
        await assert.rejects(sm.restart('svc'), (err) => err.code === 'E2E_PORT_NOT_OWN')
        assert.strict.deepEqual(st.kills, [st.child])
        assert.strict.equal(sm.state('svc').owned, false)
    })

    it('[SU31] 核對失敗後 cleanup 不重複殺', async function() {
        let { sm, st } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]))
        await assert.rejects(sm.startServersOnce())
        sm.cleanup()
        assert.strict.deepEqual(st.kills, [st.child])
    })

    it('[SU32] verifyOwner 可替換: 收到 svc 與 child; 拋錯走同一收尾', async function() {
        let seen = []
        let { sm, st } = mkSm(null, {
            verifyOwner: async (svc, child) => {
                seen.push([svc.port, child])
                throw new Error('自訂核對不符')
            }
        })
        await assert.rejects(sm.startServersOnce(), /自訂核對不符/)
        assert.strict.deepEqual(seen, [[PORT, st.child]])
        assert.strict.deepEqual(st.kills, [st.child])
    })

    it('[SU34] failureMode: once 首次拋錯、其後不再拋; sticky 持續拋同一錯誤', async function() {
        let a = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]))
        await assert.rejects(a.sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN')
        await a.sm.startServersOnce()
        assert.strict.equal(a.st.spawns, 1, '不重試')
        let b = mkSm(mkExec([{ listeners: ['777'], table: TABLE }]), { failureMode: 'sticky' })
        await assert.rejects(b.sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN')
        await assert.rejects(b.sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN')
        assert.strict.equal(b.st.spawns, 1, '不重試')
    })

    it('[SU35] 併發呼叫共用同一次啟動與核對', async function() {
        let n = 0
        let { sm, st } = mkSm(null, {
            verifyOwner: async () => {
                n++
            }
        })
        await Promise.all([sm.startServersOnce(), sm.startServersOnce(), sm.startServersOnce()])
        assert.strict.equal(n, 1)
        assert.strict.equal(st.spawns, 1)
    })

    it('[SU36] 核對失敗後 cleanup 再啟動: 重新偵測與核對, 符合即放行', async function() {
        //前 3 輪他人(第一次啟動), 第 4 輪起自建(第二次啟動); 探測: 自建未被收掉時有回應
        let exec = mkExec([{ listeners: ['777'], table: TABLE }, { listeners: ['777'], table: TABLE }, { listeners: ['777'], table: TABLE }, { listeners: ['100'], table: TABLE }])
        let box = {}
        let { sm, st } = mkSm(exec, { probe: async () => box.st.spawns > box.st.kills.length })
        box.st = st
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN')
        assert.deepEqual([st.spawns, st.kills.length], [1, 1])
        sm.cleanup()
        await sm.startServersOnce()
        assert.strict.equal(st.spawns, 2)
        assert.strict.equal(sm.state('svc').owned, true)
        assert.strict.deepEqual(st.noted, [st.child])
    })

    //規格 計時器相關函數之觀察回調與測試 P1～P4: 以事件同步; 同步呼叫、凍結、拋錯忽略
    it('[SU37] onTrace: 每次核對一個凍結事件(次序、結果、占用者); 回調拋錯不影響結果', async function() {
        let evs = []
        let sm = createServiceManager({
            exec: mkExecAdvanceOnListeners([{ listeners: ['777'], table: TABLE }, { listeners: null }, { listeners: ['100'], table: TABLE }]),
            pollMs: 1,
            ownerRetryMs: 1,
            sleep: async () => {},
            probe: (() => {
                let n = 0
                return async () => n++ > 0
            })(),
            killTree: () => {},
            reservation: { source: 'auto', noteOwn: () => {} },
            log: () => {},
            onTrace: (e) => {
                evs.push(e)
                throw new Error('回調拋錯')
            },
            services: [{ name: 'svc', port: PORT, readyTimeoutMs: 50, spawn: () => alive(100) }],
        })
        await sm.startServersOnce()
        assert.strict.deepEqual(evs.map((e) => [e.type, e.service, e.port, e.attempt, e.result]), [
            ['owner-check', 'svc', PORT, 1, 'foreign'],
            ['owner-check', 'svc', PORT, 2, 'query-failed'],
            ['owner-check', 'svc', PORT, 3, 'own'],
        ])
        assert.ok(evs[0].owners.includes('PID 777'), evs[0].owners)
        assert.ok(evs.every((e) => Object.isFrozen(e)))
    })

    //輸入參數之檢測機制 K3: 非預期之輸入視為未給, 改用預設, 不拋錯
    it('[SU38] 非預期之選項改用預設: verifyOwner、exec 非函數, ownerRetryMs 非有效數字', async function() {
        let sleeps = []
        let mk = (over) => createServiceManager({
            pollMs: 1,
            sleep: async (ms) => {
                sleeps.push(ms)
            },
            probe: (() => {
                let n = 0
                return async () => n++ > 0
            })(),
            killTree: () => {},
            reservation: { source: 'auto', noteOwn: () => {} },
            log: () => {},
            services: [{ name: 'svc', port: PORT, readyTimeoutMs: 50, spawn: () => alive(100) }],
            ...over,
        })
        //verifyOwner 非函數: 走預設核對(不拋 TypeError)
        await mk({ verifyOwner: 'x', exec: mkExec([{ listeners: ['100'], table: TABLE }]) }).startServersOnce()
        //ownerRetryMs 不合法: 重試間隔用預設 1000
        for (let bad of ['x', -1, NaN, null]) {
            sleeps.length = 0
            await assert.rejects(mk({ ownerRetryMs: bad, exec: mkExec([{ listeners: ['777'], table: TABLE }]) }).startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN')
            assert.strict.deepEqual(sleeps.filter((ms) => ms !== 1), [1000, 1000], `ownerRetryMs=${bad}`)
        }
        //ownerRetryMs 合法值(含 0)照用
        sleeps.length = 0
        await assert.rejects(mk({ ownerRetryMs: 0, exec: mkExec([{ listeners: ['777'], table: TABLE }]) }).startServersOnce())
        assert.strict.deepEqual(sleeps.filter((ms) => ms !== 1), [0, 0])
    })

    it('[SU33] 就緒逾時: 已導入者訊息寫明該埠占用者; 未導入者不查', async function() {
        let calls = []
        let { sm } = mkSm(mkExec([{ listeners: ['777'], table: TABLE }], calls), { probe: async () => false })
        await assert.rejects(sm.startServersOnce(), (err) => err.message.includes('server not ready') && err.message.includes('PID 777'))
        let calls2 = []
        let r2 = mkSm(mkExec([{ listeners: ['777'], table: TABLE }], calls2), { probe: async () => false, reservation: null })
        await assert.rejects(r2.sm.startServersOnce(), /server not ready/)
        assert.strict.deepEqual(calls2, [])
    })

})


describe('restart 查不到監聽者', function() {

    //probe: 一開始埠有回應(他人), spawn 之後仍有回應
    let mkRestart = (r, over = {}) => {
        let st = { n: 0, spawns: 0, foreignKills: [] }
        let list = Array.isArray(r) ? r : [r]
        let next = () => list[Math.min(st.n++, list.length - 1)]
        let sm = createServiceManager({
            pollMs: 1,
            ownerRetryMs: 1,
            portReleaseTimeoutMs: 2,
            portReleasePollMs: 1,
            sleep: async () => {},
            probe: async () => true,
            killTree: () => {},
            killListeners: (p) => {
                st.foreignKills.push(p)
                return next()
            },
            reservation: over.imported === false ? null : { source: 'pinned', noteOwn: () => {}, killOwnListeners: () => next() },
            verifyOwner: async () => {},
            killForeignOnRestart: true,
            log: () => {},
            services: [{
                name: 'svc',
                port: PORT,
                readyTimeoutMs: 50,
                spawn: () => {
                    st.spawns++
                    return alive(100)
                },
            }],
        })
        return { sm, st }
    }

    let NULLR = { pids: null, killed: [], skipped: [], tableOk: false }
    let NOTABLE = { pids: ['777'], killed: [], skipped: ['777'], kills: [], tableOk: false }
    let OK = { pids: ['100'], killed: ['100'], skipped: [], kills: [], tableOk: true }
    let SKIP = { pids: ['777'], killed: [], skipped: ['777'], kills: [], tableOk: true }

    //null 仍代表查詢失敗, 不得當成無人或自己人; 續行則新服務因埠被占而結束, 就緒探測卻由占用者回應
    it('[SU40] 查不到: 拋錯寫明, 不 spawn, 試 3 次', async function() {
        let { sm, st } = mkRestart(NULLR)
        await assert.rejects(sm.restart('svc'), /restart svc: 查不到 port 19800 之監聽者.*試了 3 次.*不續行/s)
        assert.strict.equal(st.spawns, 0)
        assert.strict.equal(st.n, 3)
    })

    it('[SU41] 查不到後恢復: 重試後續行', async function() {
        let { sm, st } = mkRestart([NULLR, NULLR, OK])
        await sm.restart('svc')
        assert.strict.equal(st.spawns, 1)
        assert.strict.equal(st.n, 3)
    })

    //行程表查不到時 skipped 是「身分未知」, 不可說成他人占用
    it('[SU42] 行程表查不到(tableOk:false): 拋「查不到」, 不說成他人占用', async function() {
        let { sm, st } = mkRestart(NOTABLE)
        await assert.rejects(sm.restart('svc'), /查不到 port 19800 之監聽者/)
        assert.strict.equal(st.spawns, 0)
    })

    it('[SU41b] onTrace: restart 查監聽者每次一個事件, ok 分得出查詢失敗', async function() {
        let evs = []
        let n = 0
        let list = [NULLR, NOTABLE, OK]
        let sm = createServiceManager({
            pollMs: 1,
            ownerRetryMs: 1,
            portReleaseTimeoutMs: 2,
            portReleasePollMs: 1,
            sleep: async () => {},
            probe: async () => true,
            killTree: () => {},
            reservation: { source: 'pinned', noteOwn: () => {}, killOwnListeners: () => list[n++] },
            verifyOwner: async () => {},
            killForeignOnRestart: true,
            log: () => {},
            onTrace: (e) => evs.push(e),
            services: [{ name: 'svc', port: PORT, readyTimeoutMs: 50, spawn: () => alive(100) }],
        })
        await sm.restart('svc')
        assert.strict.deepEqual(evs.map((e) => [e.type, e.attempt, e.ok]), [['restart-query', 1, false], ['restart-query', 2, false], ['restart-query', 3, true]])
    })

    it('[SU43] 查得到且為他人: 拋「非本實例」, 不重試', async function() {
        let { sm, st } = mkRestart(SKIP)
        await assert.rejects(sm.restart('svc'), /被非本實例之行程占用.*不下殺/s)
        assert.strict.equal(st.n, 1)
        assert.strict.equal(st.spawns, 0)
    })

    //killPortListeners 之回傳形狀(無 tableOk): 查不到只有 pids:null
    let NULLK = { pids: null, killed: [] }

    it('[SU44] 未導入: killListeners 查不到同樣拋錯不續行; 恢復則續行', async function() {
        let a = mkRestart(NULLK, { imported: false })
        await assert.rejects(a.sm.restart('svc'), /查不到 port 19800/)
        assert.strict.equal(a.st.spawns, 0)
        assert.strict.deepEqual(a.st.foreignKills, [PORT, PORT, PORT])
        let b = mkRestart([NULLK, { pids: ['9'], killed: ['9'] }], { imported: false })
        await b.sm.restart('svc')
        assert.strict.equal(b.st.spawns, 1)
    })

    //有自建: 第一次探測不通(spawn), 其後恆有回應(殺自建後埠仍被占)
    let mkOwned = (over = {}) => {
        let st = { spawns: 0, verified: [] }
        let sm = createServiceManager({
            pollMs: 1,
            portReleaseTimeoutMs: 2,
            portReleasePollMs: 1,
            sleep: async () => {},
            ownerRetryMs: 1,
            probe: async () => st.spawns > 0,
            killTree: () => {},
            reservation: { source: 'pinned', noteOwn: () => {}, killOwnListeners: () => NULLR },
            verifyOwner: async (svc, c) => {
                st.verified.push(c.pid)
                if (st.verified.length > 1) {
                    throw new Error('核對不符')
                }
            },
            log: () => {},
            services: [{
                name: 'svc',
                port: PORT,
                readyTimeoutMs: 50,
                spawn: () => alive(100 + ++st.spawns),
            }],
            ...over,
        })
        return { sm, st }
    }

    it('[SU45] 有自建且殺後仍被占(killForeignOnRestart): 查不到同樣拋錯不續行', async function() {
        let { sm, st } = mkOwned({ killForeignOnRestart: true })
        await sm.startServersOnce()
        assert.strict.equal(st.spawns, 1)
        await assert.rejects(sm.restart('svc'), /查不到 port 19800/)
        assert.strict.equal(st.spawns, 1, 'restart 不得 spawn')
    })

    it('[SU46] 未允許殺外部且有自建殺後仍被占: 續行至 spawn, 由就緒核對把關', async function() {
        let { sm, st } = mkOwned()
        await sm.startServersOnce()
        await assert.rejects(sm.restart('svc'), /核對不符/)
        assert.strict.equal(st.spawns, 2)
        assert.strict.deepEqual(st.verified, [101, 102])
    })

})


describe('reselect 用盡之訊息', function() {

    let fdRoot = path.resolve('test/_tmp/serviceOwner')
    let cnt = 0

    let mk = (over = {}) => {
        let regDir = path.join(fdRoot, `c${++cnt}`)
        fs.mkdirSync(regDir, { recursive: true })
        let queries = []
        let exec = (prog, args, o) => {
            queries.push(o.src)
            if (o.src === 'netstat') {
                return ok(`  TCP    127.0.0.1:19801    0.0.0.0:0    LISTENING    4321\r\n`)
            }
            if (o.src === 'powershell') {
                return ok(psOut([[19801, '127.0.0.1', 0, 4321]]))
            }
            if (o.src === 'tasklist') {
                return ok('"occupant.exe","4321","Console","1","1 K"')
            }
            return { status: 1, stdout: '' }
        }
        let busy = new Set(over.busy || [])
        let h = reserveE2ePorts([19801], {
            applyEnv: false,
            regDir,
            exec,
            maxTries: over.maxTries || 1,
            exists: () => true,
            log: () => {},
            probe: (ports) => ports.map((port) => (busy.has(port) ? { port, free: false, host: '127.0.0.1', code: 'EADDRINUSE' } : { port, free: true, host: '', code: '' })),
        })
        return { h, queries, busy }
    }

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    })

    //派工第 1 項: 補上觸發本次重選之埠與占用者, 行程內監聽者不必再自行補
    it('[SU50] 用盡: 訊息與 err.trigger 含觸發之埠與占用者、原因', function() {
        let { h } = mk()
        assert.throws(() => h.reselect('EADDRINUSE'), (err) => {
            assert.strict.equal(err.code, 'E2E_PORT_EXHAUSTED')
            assert.ok(err.message.includes('觸發本次重選(EADDRINUSE)'), err.message)
            assert.ok(err.message.includes('埠 19801: PID 4321 occupant.exe'), err.message)
            assert.strict.deepEqual(err.trigger, [{ port: 19801, owners: 'PID 4321 occupant.exe' }])
            assert.ok(!/:\n\n/.test(err.message), '不留空行')
            return true
        })
    })

    it('[SU51] 未給原因: 訊息寫綁定失敗', function() {
        let { h } = mk()
        assert.throws(() => h.reselect(), /觸發本次重選\(綁定失敗\)/)
    })

    it('[SU52] 其後之位移亦不可用: blocked 照舊列出, 訊息兩者皆有', function() {
        let { h, busy } = mk({ maxTries: 2 })
        busy.add(19901)
        assert.throws(() => h.reselect('EADDRINUSE'), (err) => {
            assert.strict.deepEqual(err.blocked.map((b) => b.port), [19901])
            assert.ok(err.message.includes('埠 19901(基準 19801+100)'), err.message)
            assert.ok(err.message.includes('埠 19801: PID 4321'), err.message)
            return true
        })
    })

    it('[SU53] 重選成功: 不查占用者(不多花一次查詢)', function() {
        let { h, queries } = mk({ maxTries: 2 })
        h.reselect('EADDRINUSE')
        assert.strict.deepEqual(queries, [])
        assert.strict.deepEqual(h.ports, [19901])
        h.release()
    })

    //null 代表查詢失敗: 行程表查不到時 skipped 是身分未知, 回傳值要分得出來
    it('[SU54] killOwnListeners: 用共用逾時; 監聽者查不到與行程表查不到皆標 tableOk:false; 查無監聽者為 tableOk:true', function() {
        let calls = []
        let mkH = (o) => {
            let regDir = path.join(fdRoot, `c${++cnt}`)
            fs.mkdirSync(regDir, { recursive: true })
            let h = reserveE2ePorts([19801], {
                applyEnv: false,
                regDir,
                exists: () => true,
                log: () => {},
                probe: (ports) => ports.map((port) => ({ port, free: true, host: '', code: '' })),
                exec: (prog, args, x) => {
                    calls.push({ src: x.src, timeout: x.timeout })
                    return o[x.src] || { status: 1, stdout: '', error: new Error('查詢失敗(注入)') }
                },
            })
            handles.push(h)
            return h
        }
        let handles = []
        let lis = { netstat: ok('  TCP    127.0.0.1:19801    0.0.0.0:0    LISTENING    4321\r\n'), powershell: ok(psOut([[19801, '127.0.0.1', 0, 4321]])) }
        let r1 = mkH(lis).killOwnListeners(19801)
        assert.strict.deepEqual([r1.pids, r1.killed, r1.skipped, r1.tableOk], [['4321'], [], ['4321'], false], '行程表查不到')
        assert.strict.equal(calls.find((c) => c.src === 'powershell').timeout, PORT_QUERY_TIMEOUT_MS)
        let r2 = mkH({}).killOwnListeners(19801)
        assert.strict.deepEqual([r2.pids, r2.tableOk], [null, false], '監聽者查不到')
        let r3 = mkH({ netstat: ok('  TCP    127.0.0.1:1    0.0.0.0:0    LISTENING    9\r\n'), powershell: ok(psOut([])) }).killOwnListeners(19801)
        assert.strict.deepEqual([r3.pids, r3.tableOk], [[], true], '查無監聽者')
        handles.forEach((h) => h.release())
    })

})
