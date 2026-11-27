import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { mock } from 'node:test'
import reserveE2ePorts, { assertE2eBasePort, getActiveE2ePortReservation, createE2ePortClaimer } from '../src/reserveE2ePorts.mjs'
import { PORT_QUERY_TIMEOUT_MS } from '../src/listenerPids.mjs'
import resolveE2ePort from '../src/resolveE2ePort.mjs'
import createServiceManager from '../src/createServiceManager.mjs'
import { psOut, ok } from './tools/portPidsFake.mjs'


//自動換埠之單元測試(規格〈e2e埠與多套件同跑〉E1～E7, 主控規格庫; 帳本 sgud/rule/rulebook_port.md R-*)。
//偵測與行程表一律注入, 不碰真實埠與行程; 真實監聽行程見 api-reserveE2ePorts。預約檔落 test/_tmp/reserveE2ePorts/, 不碰使用者之登錄目錄。


let fdRoot = path.resolve('test/_tmp/reserveE2ePorts')
let cnt = 0
let handles = []


//每案一個登錄目錄與環境
function mk(busy = [], over = {}) {
    let regDir = path.join(fdRoot, `c${++cnt}`)
    fs.mkdirSync(regDir, { recursive: true })
    let probes = []
    let logs = []
    let state = { busy: new Set(busy) }
    let probe = (ports) => {
        probes.push([...ports])
        return ports.map((port) => (state.busy.has(port) ? { port, free: false, host: '127.0.0.1', code: 'EADDRINUSE' } : { port, free: true, host: '', code: '' }))
    }
    //占用者查詢: 被占用之埠與 over.listeners 所列之埠回 PID 4321; tasklist 回映像名
    let kills = []
    let table = over.table || []
    let listenPorts = () => [...new Set([...state.busy, ...(over.listeners || [])])]
    let exec = (prog, args, o) => {
        if (o.src === 'netstat') {
            return ok(listenPorts().map((p) => `  TCP    127.0.0.1:${p}    0.0.0.0:0    LISTENING    4321\r\n`).join(''))
        }
        if (o.src === 'powershell') {
            return ok(psOut(listenPorts().map((p) => [p, '127.0.0.1', 0, 4321])))
        }
        if (o.src === 'tasklist') {
            return { status: 0, stdout: '"occupant.exe","4321","Console","1","1 K"' }
        }
        if (o.src === 'table') {
            return { status: 0, stdout: table.map((r) => `${r.pid} ${r.ppid} ${new Date(r.startMs).toISOString()} ${r.image || 'x.exe'}`).join('\r\n') }
        }
        if (o.src === 'kill') {
            kills.push(...o.targets)
            return { status: 0, stdout: o.targets.map((t) => `${t.pid} killed`).join('\r\n') }
        }
        throw new Error(`未預期之 src: ${o.src}`)
    }
    let env = over.env || {}
    let opt = { regDir, probe, exec, env, log: (s) => logs.push(String(s)), exists: over.exists || (() => true), ...over.opt }
    return { regDir, probes, logs, state, kills, env, opt, exec }
}


function reserve(fx, ports, o = {}) {
    let h = reserveE2ePorts(ports, { ...fx.opt, ...o })
    handles.push(h)
    return h
}


let fileOf = (fx, port) => path.join(fx.regDir, `p${port}.json`)
let readFile = (fx, port) => JSON.parse(fs.readFileSync(fileOf(fx, port), 'utf8'))
let regFiles = (fx) => fs.readdirSync(fx.regDir).sort()


//寫一筆他人之預約
function writeHolder(fx, port, info) {
    fs.writeFileSync(fileOf(fx, port), JSON.stringify({ token: 'other-token', pid: 999001, startApproxMs: Date.now() - 1000, root: 'C:\\other', known: [], port, ...info }))
}


//可控之行程表來源(注入 opt.tableAsync): 每次取樣嘗試記下其回調, 由測試決定何時以什麼結果完成; reached(n)等第 n 次嘗試發出(事件同步, 不以延時)
function mkTableSource() {
    let calls = []
    let waiters = []
    let fn = (cb) => {
        calls.push(cb)
        waiters.filter((w) => calls.length >= w.n).forEach((w) => w.resolve())
        waiters = waiters.filter((w) => calls.length < w.n)
    }
    let reached = (n) => (calls.length >= n ? Promise.resolve() : new Promise((resolve) => waiters.push({ n, resolve })))
    return { calls, fn, reached }
}


//p 此刻是否尚未解開: 讓出一輪事件迴圈後仍未解開者為真(用於「尚未給行程表所以不可能解開」之否定斷言, 無計時器參與, 不受負載影響)
function isPending(p) {
    return Promise.race([p.then(() => false, () => false), new Promise((resolve) => setImmediate(() => resolve(true)))])
}


let rowOf = (pid) => ({ pid, ppid: 1, startMs: 5000 + pid, image: 'svc.exe' })
let childOf = (pid, alive = true) => ({ pid, exitCode: alive ? null : 0, signalCode: null })
let NOTE_TYPES = ['note-attempt', 'noted', 'note-failed']


describe('reserveE2ePorts', function() {

    before(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    afterEach(function() {
        handles.splice(0).forEach((h) => h.release())
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        assert.strict.equal(getActiveE2ePortReservation(), null, '不得留下行程內保留(其後之 createServiceManager 測試會當成已導入)')
    })

    describe('基準埠空閒', function() {

        //E1: 沒被占用時行為與標準圖都不變
        it('[PR01] 全部空閒: 即基準埠, 位移環境變數維持未設, resolveE2ePort 回基準埠; 只偵測一次; 實際埠印入輸出', function() {
            let fx = mk()
            let h = reserve(fx, [11007, 8080])
            assert.strict.deepEqual([h.offset, h.shifted, h.source, h.ports, h.basePorts], [0, false, 'auto', [11007, 8080], [11007, 8080]])
            assert.strict.equal(Object.prototype.hasOwnProperty.call(fx.env, 'E2E_PORT_OFFSET'), false)
            assert.strict.equal(resolveE2ePort(8080, { env: fx.env }), 8080)
            assert.strict.deepEqual(fx.probes, [[11007, 8080]])
            //E6: 實際使用之埠印入輸出
            assert.strict.ok(fx.logs.some((l) => l.includes('[e2e-port]') && l.includes('11007, 8080') && l.includes('基準埠')), fx.logs.join('\n'))
        })

        it('[PR01b] 預約檔: 每埠一檔, 記 PID 與專案根, 不記命令列; 上層識別碼寫入環境變數', function() {
            let fx = mk()
            let h = reserve(fx, [11007, 8080], { root: 'C:\\proj' })
            assert.strict.deepEqual(regFiles(fx), ['p11007.json', 'p8080.json'])
            let o = readFile(fx, 8080)
            assert.strict.deepEqual([o.pid, o.token, o.port, o.offset], [process.pid, h.token, 8080, 0])
            assert.strict.equal(o.root, path.resolve('C:\\proj'))
            assert.strict.ok(Number.isFinite(o.startApproxMs))
            assert.strict.deepEqual(o.known, [])
            assert.strict.equal(fx.env.E2E_PORT_HOLD, h.token)
        })

        it('[PR01c] 空陣列: 不預約、不偵測, 位移取環境變數', function() {
            let fx = mk()
            let h = reserve(fx, [])
            assert.strict.deepEqual([h.offset, h.ports], [0, []])
            assert.strict.deepEqual(regFiles(fx), [])
        })

    })

    describe('占用與整組移位', function() {

        //E2、E3: 被占用就自動換可用之埠; 同一實例之多個埠一起移位
        it('[PR02] 部分被占用: 整組移位, 對應關係不變, 寫入 E2E_PORT_OFFSET, resolveE2ePort 隨之; 基準埠之預約已撤回', function() {
            let fx = mk([8080])
            let h = reserve(fx, [11007, 8080])
            assert.strict.deepEqual([h.offset, h.shifted, h.ports], [100, true, [11107, 8180]])
            assert.strict.equal(h.portOf(8080) - h.portOf(11007), 8080 - 11007, '對應關係不變')
            assert.strict.equal(fx.env.E2E_PORT_OFFSET, '100')
            assert.strict.equal(resolveE2ePort(11007, { env: fx.env }), 11107)
            assert.strict.deepEqual(regFiles(fx), ['p11107.json', 'p8180.json'], '空閒之 11007 不得留下預約')
            //E5、E6: 訊息寫明誰占用
            assert.strict.ok(fx.logs.some((l) => l.includes('略過') && l.includes('埠 8080') && l.includes('PID 4321 occupant.exe')), fx.logs.join('\n'))
            assert.strict.ok(fx.logs.some((l) => l.includes('實際埠 [11107, 8180]') && l.includes('位移 100')), fx.logs.join('\n'))
        })

        it('[PR03] 連續被占用: 依序試下一個位移, 不隨機; portStep 可改', function() {
            let fx = mk([8080, 11107])
            let h = reserve(fx, [11007, 8080])
            assert.strict.deepEqual(h.ports, [11207, 8280])
            assert.strict.deepEqual(fx.probes, [[11007, 8080], [11107, 8180], [11207, 8280]])
            let fx2 = mk([8080])
            assert.strict.deepEqual(reserve(fx2, [8080], { portStep: 7 }).ports, [8087])
        })

        //E5: 重選上限內仍失敗就停止, 訊息寫明誰占用
        it('[PR04] 重選用盡: 拋 E2E_PORT_EXHAUSTED, 列出每個位移之占用者; 不留預約、不改環境變數; 只試 maxTries 次', function() {
            let fx = mk([8080, 8180, 8280])
            let err = null
            try {
                reserve(fx, [8080], { maxTries: 3 })
            }
            catch (e) {
                err = e
            }
            assert.ok(err)
            assert.strict.equal(err.code, 'E2E_PORT_EXHAUSTED')
            assert.strict.deepEqual(err.blocked.map((b) => b.port), [8080, 8180, 8280])
            assert.strict.ok(err.message.includes('埠 8280') && err.message.includes('PID 4321 occupant.exe') && err.message.includes('未下殺'), err.message)
            assert.strict.equal(fx.probes.length, 3)
            assert.strict.deepEqual(regFiles(fx), [])
            assert.strict.deepEqual(Object.keys(fx.env), [])
            assert.strict.deepEqual(fx.kills, [], '絕不殺占用者')
        })

        it('[PR04b] 位移後超過 65535: 停止並說明, 不繞回', function() {
            let fx = mk([65500])
            assert.throws(() => reserve(fx, [65500]), (e) => e.code === 'E2E_PORT_EXHAUSTED' && /超過 65535/.test(e.message))
        })

        it('[PR05] avoid: 落在其上之位移直接跳過且不計次數', function() {
            let fx = mk([8080])
            let h = reserve(fx, [8080], { avoid: [8180], maxTries: 2 })
            assert.strict.deepEqual(h.ports, [8280])
            assert.strict.deepEqual(fx.probes, [[8080], [8280]])
        })

        //E4: 絕不殺占用者
        it('[PR06] 占用者一律不下殺(無下殺呼叫)', function() {
            let fx = mk([8080])
            reserve(fx, [8080])
            assert.strict.deepEqual(fx.kills, [])
        })

    })

    describe('跨行程預約', function() {

        //主控已定 4: 兩個 e2e 同時啟動不可選到同一組埠
        it('[PR10] 他人之預約(持有者存活): 視同占用而換埠, 不覆蓋其預約; 訊息寫明預約者', function() {
            let fx = mk()
            writeHolder(fx, 8080, { pid: process.pid, startApproxMs: Date.now() - process.uptime() * 1000 })
            let before = fs.readFileSync(fileOf(fx, 8080), 'utf8')
            let h = reserve(fx, [8080], { exec: fx.exec })
            assert.strict.deepEqual(h.ports, [8180])
            assert.strict.equal(fs.readFileSync(fileOf(fx, 8080), 'utf8'), before, '他人之預約不得被改動')
            assert.strict.ok(fx.logs.some((l) => l.includes('RESERVED') && l.includes(`PID ${process.pid}`) && l.includes('C:\\other')), fx.logs.join('\n'))
            assert.strict.deepEqual(fx.probes, [[8180]], '被預約之埠不做實際綁定(綁定會干擾持有者)')
        })

        it('[PR11] 只搶到部分: 撤回已取得者; 取得順序由小到大(同時開跑者不會各持一部分而互相讓開)', function() {
            let fx = mk()
            writeHolder(fx, 8080, {})
            //判定持有者時(取 8080 失敗之當下)不得已持有較大之 11007: 由小到大取
            let seen = []
            let h = reserve(fx, [11007, 8080], {
                exists: () => {
                    seen.push(fs.existsSync(fileOf(fx, 11007)))
                    return true
                }
            })
            assert.strict.equal(seen[0], false, '先取最小之埠')
            assert.strict.deepEqual(h.ports, [11107, 8180])
            assert.strict.deepEqual(regFiles(fx), ['p11107.json', 'p8080.json', 'p8180.json'], '11007 未被取得(8080 先失敗); 他人之 8080 仍在')
            //反向: 較大之埠被占, 較小者已取得即須撤回
            let fx2 = mk()
            writeHolder(fx2, 11007, {})
            let h2 = reserve(fx2, [11007, 8080])
            assert.strict.deepEqual(h2.ports, [11107, 8180])
            assert.strict.equal(fs.existsSync(fileOf(fx2, 8080)), false, '已取得之 8080 須撤回')
        })

        it('[PR12] 實際綁定未過: 撤回預約再換位移', function() {
            let fx = mk([11007])
            let h = reserve(fx, [11007, 8080])
            assert.strict.equal(h.offset, 100)
            assert.strict.equal(fs.existsSync(fileOf(fx, 8080)), false)
            assert.strict.equal(fs.existsSync(fileOf(fx, 11007)), false)
        })

        it('[PR13] 不同持有者同時取同一埠: 排他建立, 只有一個取得', function() {
            let fx = mk()
            let a = createE2ePortClaimer({ regDir: fx.regDir, probe: fx.opt.probe, exec: fx.exec, env: {}, log: () => {} })
            let b = createE2ePortClaimer({ regDir: fx.regDir, probe: fx.opt.probe, exec: fx.exec, env: {}, log: () => {}, exists: () => true })
            let ra = a.tryOffset([8080], 0)
            let rb = b.tryOffset([8080], 0)
            assert.strict.deepEqual([ra.ok, rb.ok], [true, false])
            a.releaseAll()
            assert.strict.equal(b.tryOffset([8080], 0).ok, true, '釋放後可取得')
            b.releaseAll()
            assert.strict.deepEqual(regFiles(fx), [])
        })

        //主控已定 4: 預約殘留(持有者已死)要能回收
        it('[PR14] 持有者已死: 回收其預約, 取得基準埠; 他專案之殘留不下殺任何行程', function() {
            let fx = mk([], { exists: () => false, table: [{ pid: 7777, ppid: 1, startMs: 1000, image: 'orphan.exe' }] })
            writeHolder(fx, 8080, { known: [{ pid: 7777, startMs: 1000 }] })
            let h = reserve(fx, [8080])
            assert.strict.deepEqual(h.ports, [8080])
            assert.strict.equal(readFile(fx, 8080).token, h.token)
            assert.strict.deepEqual(fx.kills, [], '他專案之殘留不殺')
        })

        it('[PR14b] PID 存在而起始時間差逾容差(PID 回收): 視為已死; 容差內視為仍在; 查不到行程表或查無此 PID 視為仍在', function() {
            let now = Date.now()
            let cases = [
                { start: now - 3600000, approx: now, want: 0, label: '差 1 小時' },
                { start: now - 30000, approx: now, want: 100, label: '差 30 秒' },
            ]
            for (let c of cases) {
                let fx = mk([], { table: [{ pid: 999001, ppid: 1, startMs: c.start }] })
                writeHolder(fx, 8080, { startApproxMs: c.approx })
                assert.strict.equal(reserve(fx, [8080]).offset, c.want, c.label)
            }
            let fx2 = mk([], { table: [{ pid: 1, ppid: 0, startMs: 1 }] })
            writeHolder(fx2, 8080, { startApproxMs: now })
            assert.strict.equal(reserve(fx2, [8080]).offset, 100, '行程表查無此 PID')
            let fx3 = mk()
            writeHolder(fx3, 8080, { startApproxMs: now })
            let execFail = (prog, args, o) => (o.src === 'table' ? { status: 1, stdout: '' } : fx3.exec(prog, args, o))
            assert.strict.equal(reserve(fx3, [8080], { exec: execFail }).offset, 100, '取不到行程表')
            let fx4 = mk()
            writeHolder(fx4, 8080, { startApproxMs: 'x' })
            assert.strict.equal(reserve(fx4, [8080]).offset, 100, '無起始時間')
        })

        //E4 與主控已定 3: 正面確認是本實例之殘留才殺, 判定依身分確認
        it('[PR15] 本專案之殘留: 依 PID 與起始時間完全相符才下殺, 回到基準埠; PID 回收者不殺', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk(['never'], { exists: () => false, table: [{ pid: 7777, ppid: 1, startMs: 1000, image: 'srv.exe' }, { pid: 8888, ppid: 1, startMs: 2500, image: 'recycled.exe' }] })
            writeHolder(fx, 8080, { root, known: [{ pid: 7777, startMs: 1000 }, { pid: 8888, startMs: 2000 }] })
            //殺後埠釋放
            let h = reserve(fx, [8080], { root })
            assert.strict.deepEqual(h.ports, [8080])
            assert.strict.deepEqual(fx.kills, [{ pid: 7777, startMs: 1000 }], '只殺完全相符者')
            assert.strict.ok(fx.logs.some((l) => l.includes('回收本專案之殘留預約') && l.includes('依身分')), fx.logs.join('\n'))
            assert.strict.ok(fx.logs.some((l) => l.includes('[e2e-port] 下殺 PID 7777') && l.includes('依據 identity') && l.includes('階段 stale-reservation')), fx.logs.join('\n'))
        })

        it('[PR15b] 本專案之殘留下殺後埠片刻才釋放: 等待後取得基準埠, 不換埠', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk([8080], { exists: () => false, table: [{ pid: 7777, ppid: 1, startMs: 1000 }] })
            writeHolder(fx, 8080, { root, known: [{ pid: 7777, startMs: 1000 }] })
            let n = 0
            let probe = (ports) => {
                n++
                return ports.map((port) => (n <= 2 ? { port, free: false, host: '127.0.0.1', code: 'EADDRINUSE' } : { port, free: true, host: '', code: '' }))
            }
            let h = reserve(fx, [8080], { root, probe })
            assert.strict.deepEqual(h.ports, [8080])
        })

        //pe316 第 2 項: 殺殘留後等待釋放時, 偵測失敗(null)不是「全部可用」。8080 之偵測: 第 1 次(殺殘留前)占用, 其後 seq 依序回應
        function probeSeq(seq) {
            let n = 0
            let calls = []
            let probe = (ports) => {
                calls.push([...ports])
                if (ports[0] !== 8080) {
                    return ports.map((port) => ({ port, free: true, host: '', code: '' }))
                }
                let v = n < seq.length ? seq[n] : seq[seq.length - 1]
                n++
                return v === null ? null : ports.map((port) => (v === 'busy' ? { port, free: false, host: '127.0.0.1', code: 'EADDRINUSE' } : { port, free: true, host: '', code: '' }))
            }
            return { probe, calls8080: () => calls.filter((c) => c[0] === 8080).length }
        }

        //對應 pe316 第 2 項「null 視為仍忙, 換下一個位移; 訊息寫明查詢失敗」
        it('[PR15d] 殺殘留後等待釋放時偵測一直失敗(null): 視為仍忙, 換下一個位移, 訊息寫明偵測失敗; 不當成全部可用', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk([], { exists: () => false, listeners: [8080], table: [{ pid: 7777, ppid: 1, startMs: 1000, image: 'srv.exe' }] })
            writeHolder(fx, 8080, { root, known: [{ pid: 7777, startMs: 1000 }] })
            let ps = probeSeq(['busy', null])
            let evs = []
            let h = reserve(fx, [8080], { root, probe: ps.probe, onTrace: (e) => evs.push(e) })
            assert.strict.deepEqual(h.ports, [8180], '偵測失敗不得當成 8080 可用')
            assert.strict.deepEqual(fx.kills, [{ pid: 7777, startMs: 1000 }], '殘留仍依身分下殺(判準不變)')
            assert.strict.equal(ps.calls8080(), 26, '殺後等待上限 25 次, 每次皆失敗')
            let text = fx.logs.join('\n')
            assert.strict.ok(text.includes('略過 埠 8080') && text.includes('偵測子行程失敗') && text.includes('無法確認'), text)
            assert.strict.ok(text.includes('EADDRINUSE@127.0.0.1'), `訊息保留最後一次成功偵測之結果: ${text}`)
            assert.strict.ok(text.includes('PID 4321'), `訊息仍列出查得之占用者: ${text}`)
            assert.strict.deepEqual(evs.filter((e) => e.type === 'blocked').map((e) => e.codes), [['PROBE_FAILED']])
            assert.strict.deepEqual(regFiles(fx), ['p8180.json'], '撤回 8080 之預約')
        })

        it('[PR15e] 殺殘留後等待釋放時偵測一度失敗(null)再恢復: 不因 null 提早放行, 繼續等到偵測回報可用才取得基準埠', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk([], { exists: () => false, table: [{ pid: 7777, ppid: 1, startMs: 1000 }] })
            writeHolder(fx, 8080, { root, known: [{ pid: 7777, startMs: 1000 }] })
            //殺前占用 → null → null → 仍占用 → 可用
            let seq = ['busy', null, null, 'busy', 'free']
            let ps = probeSeq(seq)
            let h = reserve(fx, [8080], { root, probe: ps.probe })
            assert.strict.deepEqual(h.ports, [8080])
            assert.strict.equal(ps.calls8080(), seq.length, '兩次失敗與其後之占用皆須繼續等, 不得在 null 時提早放行')
            assert.strict.deepEqual(fx.kills, [{ pid: 7777, startMs: 1000 }])
        })

        //偵測失敗只在「最後一次偵測」仍失敗時才算: 中途失敗、其後成功偵測到仍占用者, 以最後一次成功偵測為準
        it('[PR15g] 殺殘留後偵測中途失敗一次、其後成功偵測且一直占用: 照一般占用換埠, code 為偵測所回(非 PROBE_FAILED), 訊息不寫偵測失敗', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk([], { exists: () => false, listeners: [8080], table: [{ pid: 7777, ppid: 1, startMs: 1000 }] })
            writeHolder(fx, 8080, { root, known: [{ pid: 7777, startMs: 1000 }] })
            let ps = probeSeq(['busy', null, 'busy'])
            let evs = []
            let h = reserve(fx, [8080], { root, probe: ps.probe, onTrace: (e) => evs.push(e) })
            assert.strict.deepEqual(h.ports, [8180])
            assert.strict.equal(ps.calls8080(), 26)
            assert.strict.deepEqual(evs.filter((e) => e.type === 'blocked').map((e) => e.codes), [['EADDRINUSE']])
            let text = fx.logs.join('\n')
            assert.strict.ok(text.includes('略過 埠 8080') && text.includes('EADDRINUSE@127.0.0.1'), text)
            assert.strict.ok(!text.includes('偵測子行程失敗'), text)
        })

        it('[PR15f] 殺殘留後第一次偵測即回報可用、或沒有殘留可殺: 不進入等待迴圈(沒有占用時之行為不變)', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk([], { exists: () => false, table: [{ pid: 7777, ppid: 1, startMs: 1000 }] })
            writeHolder(fx, 8080, { root, known: [{ pid: 7777, startMs: 1000 }] })
            let ps = probeSeq(['free'])
            assert.strict.deepEqual(reserve(fx, [8080], { root, probe: ps.probe }).ports, [8080])
            assert.strict.equal(ps.calls8080(), 1)
            //沒有殘留可殺(kills 為空), 占用者仍在: 不等待, 直接換埠
            let fx2 = mk([8080])
            let ps2 = probeSeq(['busy'])
            assert.strict.deepEqual(reserve(fx2, [8080], { probe: ps2.probe }).ports, [8180])
            assert.strict.equal(ps2.calls8080(), 1)
        })

        it('[PR15c] 同一專案之殘留無 known: 只回收預約, 不下殺; 占用者仍在即換埠', function() {
            let root = path.resolve('C:\\proj')
            let fx = mk([8080], { exists: () => false })
            writeHolder(fx, 8080, { root, known: [] })
            let h = reserve(fx, [8080], { root })
            assert.strict.deepEqual(h.ports, [8180])
            assert.strict.deepEqual(fx.kills, [])
        })

        it('[PR16] 內容不可讀: 剛建立者(60 秒內)視為仍在; 放久者視為已死可回收', function() {
            let fx = mk()
            fs.writeFileSync(fileOf(fx, 8080), '{bad')
            assert.strict.equal(reserve(fx, [8080]).offset, 100, '剛建立')
            let fx2 = mk()
            fs.writeFileSync(fileOf(fx2, 8080), '{bad')
            let old = new Date(Date.now() - 120000)
            fs.utimesSync(fileOf(fx2, 8080), old, old)
            assert.strict.equal(reserve(fx2, [8080]).offset, 0, '放久')
        })

        it('[PR17] 回收守衛: 他行程回收中則換埠; 守衛殘留逾 60 秒可清除; 回收後不留守衛檔', function() {
            let fx = mk([], { exists: () => false })
            writeHolder(fx, 8080, {})
            fs.writeFileSync(`${fileOf(fx, 8080)}.takeover`, '1')
            assert.strict.equal(reserve(fx, [8080]).offset, 100, '回收中')
            let fx2 = mk([], { exists: () => false })
            writeHolder(fx2, 8080, {})
            fs.writeFileSync(`${fileOf(fx2, 8080)}.takeover`, '1')
            let old = new Date(Date.now() - 120000)
            fs.utimesSync(`${fileOf(fx2, 8080)}.takeover`, old, old)
            assert.strict.equal(reserve(fx2, [8080]).offset, 0, '守衛殘留')
            assert.strict.deepEqual(regFiles(fx2), ['p8080.json'])
        })

        it('[PR18] 釋放: 只刪自己之預約、還原環境變數、可重複呼叫; 釋放後他人可取得', function() {
            let fx = mk([8080])
            fx.env.KEEP = '1'
            let h = reserve(fx, [8080])
            assert.strict.equal(fx.env.E2E_PORT_OFFSET, '100')
            //預約檔被他人取代(異常情形)後不得刪除
            fs.writeFileSync(fileOf(fx, 8180), JSON.stringify({ token: 'someone-else', pid: 1, port: 8180 }))
            h.release()
            h.release()
            assert.strict.deepEqual(fx.env, { KEEP: '1' })
            assert.strict.equal(readFile(fx, 8180).token, 'someone-else')
            assert.strict.equal(getActiveE2ePortReservation(), null)
        })

        it('[PR19] 登錄目錄無法建立: 不預約、只靠實際綁定, 大聲警告, 仍可換埠', function() {
            let fx = mk([8080])
            let bad = path.join(fx.regDir, 'file')
            fs.writeFileSync(bad, 'x')
            let h = reserve(fx, [8080], { regDir: path.join(bad, 'sub') })
            assert.strict.deepEqual(h.ports, [8180])
            assert.strict.ok(fx.logs.some((l) => l.includes('無法建立預約目錄') && l.includes('同時開跑')), fx.logs.join('\n'))
        })

        it('[PR20] 偵測子行程失敗: 警告後照預約結果繼續(不因偵測工具壞掉而換埠或中止)', function() {
            let fx = mk()
            let h = reserve(fx, [8080], { probe: () => null })
            assert.strict.deepEqual(h.ports, [8080])
            assert.strict.ok(fx.logs.some((l) => l.includes('偵測子行程失敗')), fx.logs.join('\n'))
            assert.strict.deepEqual(regFiles(fx), ['p8080.json'])
        })

    })

    describe('與 E2E_PORT_OFFSET、多開之關係', function() {

        //規格 §2 末: 多開之 E2E_PORT_OFFSET 由工具指定各組位移; 單開之自動換埠不得與之衝突
        it('[PR30] 已指定位移: 不換埠(即使被占用), 只告警; 仍預約該組埠', function() {
            let fx = mk([8280], { env: { E2E_PORT_OFFSET: '200' } })
            let h = reserve(fx, [8080])
            assert.strict.deepEqual([h.source, h.offset, h.ports], ['pinned', 200, [8280]])
            assert.strict.equal(fx.env.E2E_PORT_OFFSET, '200')
            assert.strict.ok(fx.logs.some((l) => l.includes('不換埠') && l.includes('埠 8280')), fx.logs.join('\n'))
            let fx2 = mk([], { env: { E2E_PORT_OFFSET: '200' } })
            reserve(fx2, [8080])
            assert.strict.deepEqual(regFiles(fx2), ['p8280.json'])
        })

        it('[PR30b] 手動指定 0: 明確要求基準埠, 即使被占用也不換(沿用政策之逃生口)', function() {
            let fx = mk([8080], { env: { E2E_PORT_OFFSET: '0' } })
            let h = reserve(fx, [8080])
            assert.strict.deepEqual([h.source, h.offset, h.ports], ['pinned', 0, [8080]])
        })

        it('[PR31] 上層已保留(E2E_PORT_HOLD): 沿用其位移, 不偵測、不預約; 不可重選', function() {
            let fx = mk([8280], { env: { E2E_PORT_OFFSET: '200', E2E_PORT_HOLD: 'parent' } })
            let h = reserve(fx, [8080])
            assert.strict.deepEqual([h.source, h.offset, h.ports], ['inherited', 200, [8280]])
            assert.strict.deepEqual(fx.probes, [])
            assert.strict.deepEqual(regFiles(fx), [])
            assert.throws(() => h.reselect(), /不可重選/)
            //上層位移為 0 時環境變數未設
            let fx2 = mk([8080], { env: { E2E_PORT_HOLD: 'parent' } })
            assert.strict.deepEqual(reserve(fx2, [8080]).ports, [8080])
        })

        it('[PR32] E2E_PORT_OFFSET 不合法: 同 resolveE2ePort 拋錯, 不靜默沿用', function() {
            for (let bad of ['abc', '-1', '1.5']) {
                assert.throws(() => reserve(mk([], { env: { E2E_PORT_OFFSET: bad } }), [8080]), /E2E_PORT_OFFSET 須為非負整數/, bad)
            }
            assert.throws(() => reserve(mk([], { env: { E2E_PORT_OFFSET: '70000' } }), [8080]), /超過 65535/)
        })

        it('[PR33] 空白或空字串之位移視為未設', function() {
            for (let v of ['', '  ']) {
                let fx = mk([8080], { env: { E2E_PORT_OFFSET: v } })
                assert.strict.equal(reserve(fx, [8080]).source, 'auto', `「${v}」`)
                assert.strict.equal(fx.env.E2E_PORT_OFFSET, '100')
            }
        })

        it('[PR34] 同一行程再次呼叫: 已宣告之埠回同一物件; 新增之埠在同一位移下預約; 該位移不可用即拋錯(位移已被使用, 不可再變)', function() {
            let fx = mk([8080])
            let h = reserve(fx, [8080])
            assert.strict.equal(reserve(fx, [8080]), h)
            let h2 = reserve(fx, [9000])
            assert.strict.equal(h2, h)
            assert.strict.deepEqual(h.ports, [8180, 9100])
            assert.strict.deepEqual(regFiles(fx), ['p8180.json', 'p9100.json'])
            fx.state.busy.add(9300)
            assert.throws(() => reserve(fx, [9200]), /本行程已選定位移 100/)
        })

        it('[PR35] applyEnv:false: 不寫環境變數, 各組獨立, 由 portOf 取實際埠', function() {
            let fx = mk([8136])
            let a = reserve(fx, [8136], { applyEnv: false })
            let b = reserve(fx, [8137], { applyEnv: false })
            assert.strict.deepEqual([a.portOf(8136), b.portOf(8137)], [8236, 8137])
            assert.deepEqual(fx.env, {})
            assert.strict.equal(getActiveE2ePortReservation(), null, '不佔用行程內保留')
        })

        it('[PR35b] applyEnv:false 於多開實例: 以指定之位移為起點; 上層已預約之埠視為已持有', function() {
            let fx = mk([], { env: { E2E_PORT_OFFSET: '100', E2E_PORT_HOLD: 'parent' } })
            writeHolder(fx, 8236, { token: 'parent' })
            let h = reserve(fx, [8136], { applyEnv: false })
            assert.strict.deepEqual(h.ports, [8236])
            h.release()
            assert.strict.equal(readFile(fx, 8236).token, 'parent', '上層之預約不得被釋放')
        })

    })

    describe('綁定被搶走(E5)', function() {

        it('[PR40] reselect: 換下一個位移, 舊預約撤回, 環境變數更新; 綁定失敗後呼叫', function() {
            let fx = mk()
            let h = reserve(fx, [8080])
            assert.strict.equal(h.offset, 0)
            h.reselect('EADDRINUSE')
            assert.strict.deepEqual([h.offset, h.shifted, h.ports], [100, true, [8180]])
            assert.strict.equal(fx.env.E2E_PORT_OFFSET, '100')
            assert.strict.deepEqual(regFiles(fx), ['p8180.json'])
            assert.strict.ok(fx.logs.some((l) => l.includes('重選(EADDRINUSE)') && l.includes('位移 0 → 100')), fx.logs.join('\n'))
        })

        it('[PR41] reselect 與選定共用次數上限: 用盡即拋錯寫明占用者, 不留預約', function() {
            let fx = mk([8180, 8280])
            let h = reserve(fx, [8080], { maxTries: 3 })
            assert.throws(() => h.reselect(), (e) => e.code === 'E2E_PORT_EXHAUSTED' && e.message.includes('PID 4321'))
            assert.strict.deepEqual(regFiles(fx), [])
        })

    })

    describe('畫面含埠(E7): baseOnly', function() {

        it('[PR50] 基準埠空閒: 同一般; 不可重選', function() {
            let fx = mk()
            let h = reserve(fx, [8080], { baseOnly: true })
            assert.strict.deepEqual(h.ports, [8080])
            assert.throws(() => h.reselect(), /baseOnly/)
        })

        it('[PR51] 被占用: 等待, 不換埠; 釋放後取得基準埠', function() {
            let fx = mk([8080])
            let waits = 0
            let h = reserve(fx, [8080], {
                baseOnly: true,
                waitPollMs: 7,
                sleepFn: (ms) => {
                    assert.strict.equal(ms, 7)
                    waits++
                    if (waits === 3) {
                        fx.state.busy.delete(8080)
                    }
                },
            })
            assert.strict.deepEqual([h.offset, h.ports], [0, [8080]])
            assert.strict.equal(waits, 3)
            assert.strict.ok(fx.probes.every((p) => p[0] === 8080), '不得試其他埠')
            assert.strict.ok(fx.logs.some((l) => l.includes('等待中') && l.includes('不換埠')), fx.logs.join('\n'))
        })

        it('[PR52] 逾時: 拋 E2E_PORT_BASE_BUSY 寫明占用者, 不換埠、不下殺、不留預約', function() {
            let fx = mk([8080])
            let err = null
            try {
                reserve(fx, [8080], { baseOnly: true, waitTimeoutMs: 1, sleepFn: () => {} })
            }
            catch (e) {
                err = e
            }
            assert.ok(err)
            assert.strict.equal(err.code, 'E2E_PORT_BASE_BUSY')
            assert.strict.ok(err.message.includes('PID 4321') && err.message.includes('不換埠'), err.message)
            assert.strict.deepEqual(regFiles(fx), [])
            assert.strict.deepEqual(fx.kills, [])
        })

        it('[PR53] 位移已被指定為非 0: 拋錯(只能在基準埠跑)', function() {
            assert.throws(() => reserve(mk([], { env: { E2E_PORT_OFFSET: '100' } }), [8080], { baseOnly: true }), /只能在基準埠跑/)
        })

        it('[PR54] assertE2eBasePort: 基準埠通過; 位移非 0 拋錯並寫明流程與位移', function() {
            assert.strict.equal(assertE2eBasePort('f', { env: {} }), undefined)
            assert.strict.equal(assertE2eBasePort('f', { env: { E2E_PORT_OFFSET: '0' } }), undefined)
            assert.throws(() => assertE2eBasePort('e2e-apitest', { env: { E2E_PORT_OFFSET: '100' } }), /e2e-apitest.*只能在基準埠跑.*100/)
            assert.throws(() => assertE2eBasePort('', { env: { E2E_PORT_OFFSET: 'x' } }), /須為非負整數/)
        })

    })

    //跨套件規格〈計時器相關函數之觀察回調與測試〉: 等待與重試類函數提供 opt.onTrace, 不影響被觀察之函數
    describe('觀察回調(onTrace)', function() {

        it('[PR55] 事件依序: try → blocked → try → selected; 事件凍結、未傳內部欄位', function() {
            let fx = mk([8080])
            let ev = []
            reserve(fx, [8080], { onTrace: (e) => ev.push(e) })
            assert.strict.deepEqual(ev.map((e) => e.type), ['try', 'blocked', 'try', 'selected'])
            assert.strict.deepEqual(ev[1], { type: 'blocked', offset: 0, ports: [8080], codes: ['EADDRINUSE'] })
            assert.strict.deepEqual(ev[3], { type: 'selected', offset: 100, ports: [8180], source: 'auto' })
            assert.strict.ok(ev.every((e) => Object.isFrozen(e)))
        })

        it('[PR56] baseOnly 等待發 wait 事件, 以事件同步釋放; 用盡發 exhausted; 指定位移者只發 selected', function() {
            let fx = mk([8080])
            let ev = []
            reserve(fx, [8080], {
                baseOnly: true,
                //防懸置上限: 事件沒發出時於此逾時失敗, 不會卡住(同步等待, mocha 之逾時管不到)
                waitTimeoutMs: 3000,
                sleepFn: () => {},
                onTrace: (e) => {
                    ev.push(e.type)
                    //收到第二次等待才釋放: 不以時間同步
                    if (ev.filter((v) => v === 'wait').length === 2) {
                        fx.state.busy.delete(8080)
                    }
                },
            })
            assert.strict.deepEqual(ev, ['wait', 'wait', 'selected'])
            let ev2 = []
            assert.throws(() => reserve(mk([8080, 8180]), [8080], { maxTries: 2, onTrace: (e) => ev2.push(e) }), /試了 2 個位移/)
            assert.strict.deepEqual(ev2.at(-1), { type: 'exhausted', tries: 2 })
            let ev3 = []
            reserve(mk([], { env: { E2E_PORT_OFFSET: '200' } }), [8080], { onTrace: (e) => ev3.push(e.type) })
            assert.strict.deepEqual(ev3, ['selected'])
        })

        it('[PR57] 五種回調(未傳、紀錄器、拋錯、回傳 rejection、非函數): 結果相同', function() {
            let rejections = 0
            let onRej = () => {
                rejections++
            }
            process.on('unhandledRejection', onRej)
            let outs = [undefined, () => {}, () => {
                throw new Error('x')
            }, () => Promise.reject(new Error('y')), 'notFn'].map((onTrace) => {
                let fx = mk([8080])
                let h = reserve(fx, [8080], { onTrace })
                return [h.offset, h.ports, h.source]
            })
            for (let o of outs) {
                assert.strict.deepEqual(o, outs[0])
            }
            assert.strict.deepEqual(outs[0], [100, [8180], 'auto'])
            return new Promise((resolve) => setImmediate(resolve)).then(() => {
                process.removeListener('unhandledRejection', onRej)
                assert.strict.equal(rejections, 0)
            })
        })

    })

    describe('非預期輸入', function() {

        it('[PR60] basePorts 非陣列或含不合法之埠: 拋錯', function() {
            for (let bad of [null, undefined, 8080, '8080', {}]) {
                assert.throws(() => reserveE2ePorts(bad, { env: {} }), /basePorts 須為基準埠陣列/, String(bad))
            }
            for (let bad of [[0], [-1], [65536], [80.5], ['abc'], [null], [NaN]]) {
                assert.throws(() => reserveE2ePorts(bad, { env: {} }), /不合法之埠/, String(bad))
            }
        })

        it('[PR61] 數字字串視為埠; 重複之埠去重', function() {
            let fx = mk()
            assert.strict.deepEqual(reserve(fx, ['8080', 8080, 9000]).ports, [8080, 9000])
        })

        it('[PR62] opt 非物件、數值選項非正整數: 改用預設(K3)', function() {
            let fx = mk([8080])
            for (let v of [0, -1, 1.5, 'x', null]) {
                let f2 = mk([8080])
                assert.strict.equal(reserve(f2, [8080], { portStep: v, maxTries: v, waitTimeoutMs: v, waitPollMs: v }).offset, 100, String(v))
                handles.splice(0).forEach((h) => h.release())
            }
            assert.strict.deepEqual(regFiles(fx), [])
            //opt 非物件時退回預設登錄目錄: 只驗不拋錯之前提(於輸入檢查階段)
            assert.throws(() => reserveE2ePorts(null, null), /basePorts/)
        })

    })

    describe('行程身分之記錄與下殺', function() {

        //noteOwn 之背景取樣以注入之 tableAsync 同步完成
        let child = (pid, alive = true) => ({ pid, exitCode: alive ? null : 0, signalCode: null })

        it('[PR70] noteOwn: 存活之服務與其子孫以真實起始時間記入預約檔; 已結束者不記', function() {
            let table = [{ pid: 700, ppid: process.pid, startMs: 5000, image: 'cmd.exe' }, { pid: 704, ppid: 700, startMs: 5100, image: 'node.exe' }, { pid: 800, ppid: process.pid, startMs: 6000, image: 'dead.exe' }]
            let fx = mk()
            let h = reserve(fx, [8080], { tableAsync: (cb) => cb(table) })
            h.noteOwn(child(700))
            h.noteOwn(child(800, false))
            h.noteOwn(null)
            h.noteOwn({})
            let got = readFile(fx, 8080).known.map((k) => [k.pid, k.startMs]).sort()
            assert.strict.deepEqual(got, [[700, 5000], [704, 5100]])
        })

        //取樣失敗(取不到行程表)不寫入任何資料(含錯誤資料)、不拋錯; 重試用盡後如實告知(Promise 以 ok:false 解開, 見 [NO03])
        it('[PR71] noteOwn 取樣失敗(取不到行程表): 預約檔一字不動、不拋錯, 用盡次數後以 ok:false 解開', async function() {
            let fx = mk()
            let calls = 0
            let tableAsync = (cb) => {
                calls++
                cb(null)
            }
            let h = reserve(fx, [8080], { tableAsync, noteTries: 2, noteRetryMs: 1 })
            let before = fs.readFileSync(fileOf(fx, 8080), 'utf8')
            let p = h.noteOwn(child(700))
            assert.strict.deepEqual(readFile(fx, 8080).known, [], '同步回來時尚未寫入')
            let r = await p
            assert.strict.deepEqual(r, { ok: false, attempts: 2, reason: 'table-failed' })
            assert.strict.equal(calls, 2)
            assert.strict.equal(fs.readFileSync(fileOf(fx, 8080), 'utf8'), before, '失敗不得改寫預約檔')
        })

        it('[PR72] noteOwn 取樣進行中再呼叫: 不重疊, 結束後補取一次', function() {
            let pending = []
            let fx = mk()
            let h = reserve(fx, [8080], { tableAsync: (cb) => pending.push(cb) })
            h.noteOwn(child(700))
            h.noteOwn(child(704))
            assert.strict.equal(pending.length, 1)
            pending[0]([{ pid: 700, ppid: 1, startMs: 5000 }, { pid: 704, ppid: 1, startMs: 5100 }])
            assert.strict.equal(pending.length, 2)
            pending[1]([{ pid: 700, ppid: 1, startMs: 5000 }, { pid: 704, ppid: 1, startMs: 5100 }])
            assert.strict.deepEqual(readFile(fx, 8080).known.map((k) => k.pid).sort(), [700, 704])
        })

        //E4: 絕不殺占用者, 除非已正面確認是本實例之殘留
        it('[PR73] killOwnListeners: 監聽者身分相符才殺; 身分不符者留在 skipped; 查不到回 pids:null 不殺', function() {
            let table = [{ pid: 4321, ppid: 1, startMs: 5000, image: 'mine.exe' }]
            let fx = mk([], { table, listeners: [8080] })
            let h = reserve(fx, [8080], { tableAsync: (cb) => cb(table) })
            //未記入: 不殺
            let r0 = h.killOwnListeners(8080)
            assert.strict.deepEqual([r0.pids, r0.killed, r0.skipped], [['4321'], [], ['4321']])
            assert.strict.deepEqual(fx.kills, [])
            //記入後: 殺
            h.noteOwn(child(4321))
            let r1 = h.killOwnListeners(8080)
            assert.strict.deepEqual([r1.killed, r1.skipped], [['4321'], []])
            assert.strict.deepEqual(fx.kills, [{ pid: 4321, startMs: 5000 }])
            assert.strict.ok(fx.logs.some((l) => l.includes('階段 own-listener') && l.includes('依據 identity')), fx.logs.join('\n'))
            //查詢失敗
            let h2 = reserve(mk(), [8081], { exec: () => ({ status: 1, stdout: '', error: new Error('x') }) })
            assert.strict.deepEqual(h2.killOwnListeners(8081), { pids: null, killed: [], skipped: [], tableOk: false })
        })

        it('[PR73b] killOwnListeners: 只殺該埠之監聽者, 本實例之其他服務不動', function() {
            let table = [{ pid: 4321, ppid: 1, startMs: 5000, image: 'back.exe' }, { pid: 5555, ppid: 1, startMs: 6000, image: 'front.exe' }]
            let fx = mk([], { table, listeners: [8080] })
            let h = reserve(fx, [8080, 8090], { tableAsync: (cb) => cb(table) })
            h.noteOwn(child(4321))
            h.noteOwn(child(5555))
            assert.strict.deepEqual(h.killOwnListeners(8080).killed, ['4321'])
            assert.strict.deepEqual(fx.kills, [{ pid: 4321, startMs: 5000 }], '5555 不是 8080 之監聽者')
        })

        it('[PR74] killOwnListeners: PID 相同而起始時間不同(PID 回收)不殺; 預約檔內他行程記下者同持有鏈可殺', function() {
            let table = [{ pid: 4321, ppid: 1, startMs: 5001, image: 'recycled.exe' }]
            let fx = mk([], { table, listeners: [8080] })
            let h = reserve(fx, [8080])
            let o = readFile(fx, 8080)
            o.known = [{ pid: 4321, startMs: 5000 }]
            fs.writeFileSync(fileOf(fx, 8080), JSON.stringify(o))
            assert.strict.deepEqual(h.killOwnListeners(8080).killed, [])
            assert.strict.deepEqual(fx.kills, [])
            o.known = [{ pid: 4321, startMs: 5001 }]
            fs.writeFileSync(fileOf(fx, 8080), JSON.stringify(o))
            assert.strict.deepEqual(h.killOwnListeners(8080).killed, ['4321'])
        })

    })

    //noteOwn 之完成觀察點(Promise 與 onTrace)與取樣重試: 行程表以 opt.tableAsync 注入(同 opt.probe、opt.exec, 為正式注入點), 不碰真實行程表
    //斷言語意(解開時預約檔之內容、結果之 ok/attempts/reason、事件之次序與內容), 以事件與 Promise 同步, 不以延時等待
    describe('noteOwn 之完成觀察點與取樣重試', function() {

        let rejections = []
        let onRej = (reason) => rejections.push(reason)
        let warnings = []
        let onWarn = (w) => warnings.push(w)

        before(function() {
            process.on('unhandledRejection', onRej)
            process.on('warning', onWarn)
        })

        after(function() {
            process.off('unhandledRejection', onRej)
            process.off('warning', onWarn)
            assert.strict.deepEqual(rejections, [], 'noteOwn 不得產生 unhandled rejection')
        })

        afterEach(function() {
            mock.timers.reset()
        })

        //管理器之快速選項(不等待、不核對監聽者)
        let smBase = {
            pollMs: 1,
            portReleaseTimeoutMs: 5,
            portReleasePollMs: 1,
            sleep: async () => {},
            killTree: () => {},
            verifyOwner: async () => {},
            log: () => {},
        }
        let noteEvs = (ev) => ev.filter((e) => NOTE_TYPES.includes(e.type)).map((e) => ({ ...e }))
        let knownPids = (fx, port = 8080) => readFile(fx, port).known.map((k) => k.pid).sort((a, b) => a - b)

        //完成之觀察點 [R1]: 回傳 Promise, 於本次取樣已寫入預約檔後才解開
        it('[NO01] 取樣延遲完成: Promise 於預約檔寫入之後才解開(延遲落在等待期間); 事件先於解開, 事件發出時預約檔已記有該行程', async function() {
            let fx = mk()
            let src = mkTableSource()
            let seen = null
            let h = reserve(fx, [8080], {
                tableAsync: src.fn,
                onTrace: (e) => {
                    if (e.type === 'noted') {
                        seen = knownPids(fx)
                    }
                },
            })
            let p = h.noteOwn(childOf(700))
            assert.strict.ok(p instanceof Promise, 'noteOwn 須回傳 Promise')
            await src.reached(1)
            assert.strict.equal(await isPending(p), true, '行程表尚未回來, 不得解開')
            assert.strict.deepEqual(knownPids(fx), [], '尚未寫入')
            src.calls[0]([rowOf(700)])
            let r = await p
            assert.strict.deepEqual(r, { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(seen, [700], '事件發出時(解開之前)預約檔已寫入')
            assert.strict.deepEqual(readFile(fx, 8080).known.map((k) => [k.pid, k.startMs]), [[700, 5700]])
        })

        //[R2] 取樣失敗(行程表查詢回 null、逾時、拋錯、非陣列)改為有界重試
        let FAILS = [
            ['回 null(同步)', (cb) => cb(null)],
            ['回 null(非同步)', (cb) => setImmediate(() => cb(null))],
            ['同步拋錯', () => {
                throw new Error('boom')
            }],
            ['回非陣列', (cb) => cb({ rows: [] })],
        ]
        FAILS.forEach(([name, fail], i) => {
            it(`[NO02${'abcd'[i]}] 取樣失敗 2 次後成功(${name}): 重試, 結果 attempts 為 3, 預約檔已記有該行程`, async function() {
                let fx = mk()
                let ev = []
                let calls = 0
                let h = reserve(fx, [8080], {
                    noteRetryMs: 1,
                    onTrace: (e) => ev.push(e),
                    tableAsync: (cb) => {
                        calls++
                        if (calls <= 2) {
                            return fail(cb)
                        }
                        cb([rowOf(700)])
                    },
                })
                let r = await h.noteOwn(childOf(700))
                assert.strict.deepEqual(r, { ok: true, attempts: 3, reason: 'recorded' })
                assert.strict.equal(calls, 3)
                assert.strict.deepEqual(knownPids(fx), [700])
                assert.strict.deepEqual(noteEvs(ev), [
                    { type: 'note-attempt', attempt: 1, ok: false, reason: 'table-failed', count: 1 },
                    { type: 'note-attempt', attempt: 2, ok: false, reason: 'table-failed', count: 1 },
                    { type: 'note-attempt', attempt: 3, ok: true, reason: null, count: 1 },
                    { type: 'noted', pid: 700, attempts: 3 },
                ])
            })
        })

        it('[NO03] 一直失敗: 重試用盡(noteTries 次)以 ok:false 解開、不 reject; 預約檔一字不動; 其後之呼叫仍可取樣', async function() {
            let fx = mk()
            let ev = []
            let src = mkTableSource()
            let h = reserve(fx, [8080], { tableAsync: src.fn, noteTries: 4, noteRetryMs: 1, onTrace: (e) => ev.push(e) })
            let before = fs.readFileSync(fileOf(fx, 8080), 'utf8')
            let p = h.noteOwn(childOf(700))
            for (let i = 1; i <= 4; i++) {
                await src.reached(i)
                src.calls[i - 1](null)
            }
            let settled = await Promise.allSettled([p])
            assert.strict.equal(settled[0].status, 'fulfilled', '失敗須以 resolve 帶結果告知, 不得 reject')
            assert.strict.deepEqual(settled[0].value, { ok: false, attempts: 4, reason: 'table-failed' })
            assert.strict.equal(src.calls.length, 4, '用盡後不再嘗試')
            assert.strict.equal(fs.readFileSync(fileOf(fx, 8080), 'utf8'), before, '失敗不得改寫預約檔')
            let evs = noteEvs(ev)
            assert.strict.deepEqual(evs.map((e) => e.type), ['note-attempt', 'note-attempt', 'note-attempt', 'note-attempt', 'note-failed'])
            assert.strict.deepEqual(evs[4], { type: 'note-failed', pid: 700, attempts: 4, reason: 'table-failed' })
            //用盡後不卡住: 下一次呼叫另起一輪、成功
            let p2 = h.noteOwn(childOf(700))
            await src.reached(5)
            src.calls[4]([rowOf(700)])
            assert.strict.deepEqual(await p2, { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx), [700])
        })

        //[R1 合併取樣] 每個 noteOwn 之 Promise 須等到涵蓋該 child 之那次取樣寫入後才解開
        it('[NO04] 合併取樣: 取樣進行中再呼叫者排入下一輪, 須等涵蓋自己之那次取樣寫入後才解開, 不被較早開始之取樣提前了結', async function() {
            let fx = mk()
            let src = mkTableSource()
            let h = reserve(fx, [8080], { tableAsync: src.fn })
            let pA = h.noteOwn(childOf(700))
            await src.reached(1)
            let pB = h.noteOwn(childOf(704))
            assert.strict.equal(src.calls.length, 1, '不重疊')
            //第 1 輪之行程表尚無 704(其後才起)
            src.calls[0]([rowOf(700)])
            assert.strict.deepEqual(await pA, { ok: true, attempts: 1, reason: 'recorded' })
            await src.reached(2)
            assert.strict.equal(await isPending(pB), true, 'B 之 child 不在第 1 輪行程表內, 不得被第 1 輪提前解開')
            assert.strict.deepEqual(knownPids(fx), [700])
            src.calls[1]([rowOf(700), rowOf(704)])
            assert.strict.deepEqual(await pB, { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx), [700, 704])
        })

        it('[NO04b] 合併取樣: 前一輪重試用盡失敗時, 排入下一輪者不受牽連, 各自依自己那輪之結果解開', async function() {
            let fx = mk()
            let src = mkTableSource()
            let h = reserve(fx, [8080], { tableAsync: src.fn, noteTries: 2, noteRetryMs: 1 })
            let pA = h.noteOwn(childOf(700))
            await src.reached(1)
            let pB = h.noteOwn(childOf(704))
            src.calls[0](null)
            await src.reached(2)
            src.calls[1](null)
            assert.strict.deepEqual(await pA, { ok: false, attempts: 2, reason: 'table-failed' })
            await src.reached(3)
            assert.strict.equal(await isPending(pB), true, 'B 之那輪尚未給行程表')
            src.calls[2]([rowOf(700), rowOf(704)])
            assert.strict.deepEqual(await pB, { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx), [700, 704])
        })

        it('[NO04c] 合併取樣: 同一輪涵蓋多個呼叫時(count)各依自己之 child 判定, 事件依呼叫順序', async function() {
            let fx = mk()
            let src = mkTableSource()
            let ev = []
            let h = reserve(fx, [8080], { tableAsync: src.fn, onTrace: (e) => ev.push(e) })
            let p0 = h.noteOwn(childOf(700))
            await src.reached(1)
            let pExited = h.noteOwn(childOf(708, false))
            let pMissing = h.noteOwn(childOf(712))
            let pOk = h.noteOwn(childOf(704))
            src.calls[0]([rowOf(700)])
            await p0
            await src.reached(2)
            src.calls[1]([rowOf(700), rowOf(704)])
            assert.strict.deepEqual(await pExited, { ok: false, attempts: 1, reason: 'child-exited' })
            assert.strict.deepEqual(await pMissing, { ok: false, attempts: 1, reason: 'not-in-table' })
            assert.strict.deepEqual(await pOk, { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(noteEvs(ev), [
                { type: 'note-attempt', attempt: 1, ok: true, reason: null, count: 1 },
                { type: 'noted', pid: 700, attempts: 1 },
                { type: 'note-attempt', attempt: 1, ok: true, reason: null, count: 3 },
                { type: 'note-failed', pid: 708, attempts: 1, reason: 'child-exited' },
                { type: 'note-failed', pid: 712, attempts: 1, reason: 'not-in-table' },
                { type: 'noted', pid: 704, attempts: 1 },
            ])
            assert.strict.deepEqual(knownPids(fx), [700, 704])
        })

        it('[NO05] onTrace: 事件為凍結物件、次序與內容(重試 → 成功 → noted)固定, 回調拋錯不影響結果', async function() {
            let fx = mk()
            let src = mkTableSource()
            let ev = []
            let h = reserve(fx, [8080], {
                tableAsync: src.fn,
                noteRetryMs: 1,
                onTrace: (e) => {
                    ev.push(e)
                    throw new Error('回調拋錯須被忽略')
                },
            })
            let p = h.noteOwn(childOf(700))
            await src.reached(1)
            src.calls[0](null)
            await src.reached(2)
            src.calls[1]([rowOf(700)])
            assert.strict.deepEqual(await p, { ok: true, attempts: 2, reason: 'recorded' })
            let notes = ev.filter((e) => NOTE_TYPES.includes(e.type))
            assert.strict.ok(notes.every((e) => Object.isFrozen(e)), '事件須凍結')
            assert.strict.deepEqual(notes.map((e) => ({ ...e })), [
                { type: 'note-attempt', attempt: 1, ok: false, reason: 'table-failed', count: 1 },
                { type: 'note-attempt', attempt: 2, ok: true, reason: null, count: 1 },
                { type: 'noted', pid: 700, attempts: 2 },
            ])
        })

        it('[NO06] child 無效(null、undefined、{}、pid 為 0、非物件): 回傳已解開之 Promise(ok:false, attempts:0, invalid-child), 不取樣、有 note-failed 事件', async function() {
            let fx = mk()
            let ev = []
            let calls = 0
            let tableAsync = () => {
                calls++
            }
            let h = reserve(fx, [8080], { tableAsync, onTrace: (e) => ev.push(e) })
            let before = fs.readFileSync(fileOf(fx, 8080), 'utf8')
            for (let bad of [null, undefined, {}, { pid: 0 }, 5, 'x']) {
                let p = h.noteOwn(bad)
                let got
                p.then((v) => {
                    got = v
                })
                await null
                await null
                assert.strict.deepEqual(got, { ok: false, attempts: 0, reason: 'invalid-child' }, '已解開(不待任何事件)')
            }
            assert.strict.equal(calls, 0)
            assert.strict.equal(fs.readFileSync(fileOf(fx, 8080), 'utf8'), before)
            let fails = noteEvs(ev)
            assert.strict.equal(fails.length, 6)
            assert.strict.deepEqual(fails[0], { type: 'note-failed', pid: null, attempts: 0, reason: 'invalid-child' })
        })

        it('[NO07] 結果之理由: child 取樣時已結束(child-exited)、存活而行程表無其列(not-in-table); 兩者皆不記入, 其餘仍寫入', async function() {
            let fx = mk()
            let h = reserve(fx, [8080], { tableAsync: (cb) => cb([rowOf(700), rowOf(704)]) })
            assert.strict.deepEqual(await h.noteOwn(childOf(800, false)), { ok: false, attempts: 1, reason: 'child-exited' })
            assert.strict.deepEqual(await h.noteOwn(childOf(812)), { ok: false, attempts: 1, reason: 'not-in-table' })
            assert.strict.deepEqual(knownPids(fx), [], '未記入者不得出現在預約檔')
            assert.strict.deepEqual(await h.noteOwn(childOf(704)), { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx), [704])
        })

        it('[NO08] 預約檔已不存在(release 後)或屬他人(他持有鏈): 本持有鏈之檔一個都沒寫成即 ok:false/no-reservation, 不寫入、不重建; 他人之預約檔一字不動; 有一個寫成即算記入', async function() {
            let fx = mk()
            let h = reserve(fx, [8080, 9090], { tableAsync: (cb) => cb([rowOf(700)]) })
            //其中一個預約檔換成他人持有: 屬本持有鏈者(8080)照寫, 他人之檔不動, 結果為已記入
            writeHolder(fx, 9090, { known: [{ pid: 1, startMs: 2 }] })
            let other = fs.readFileSync(fileOf(fx, 9090), 'utf8')
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.equal(fs.readFileSync(fileOf(fx, 9090), 'utf8'), other, '不得把本實例之行程寫進他人之預約')
            assert.strict.deepEqual(knownPids(fx, 8080), [700], '屬本持有鏈者照寫')
            //全部屬他人: 未記入
            writeHolder(fx, 8080, { known: [{ pid: 3, startMs: 4 }] })
            let other8 = fs.readFileSync(fileOf(fx, 8080), 'utf8')
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: false, attempts: 1, reason: 'no-reservation' })
            assert.strict.equal(fs.readFileSync(fileOf(fx, 8080), 'utf8'), other8)
            //已釋放: 預約檔不在
            let fx2 = mk()
            let h2 = reserve(fx2, [8080], { tableAsync: (cb) => cb([rowOf(700)]) })
            h2.release()
            assert.strict.deepEqual(await h2.noteOwn(childOf(700)), { ok: false, attempts: 1, reason: 'no-reservation' })
            assert.strict.equal(fs.existsSync(fileOf(fx2, 8080)), false, '不得重建已釋放之預約檔')
        })

        it('[NO08b] 各 source 之寫入: inherited(上層保留, 預約檔為上層之 token, 且宣告之埠多於已預約者)、pinned(埠被後續宣告擴充)、auto 皆 ok:true 並寫入已預約之檔', async function() {
            //inherited: 預約檔屬上層(token 即 E2E_PORT_HOLD), 本行程宣告 [8080, 9090] 而上層只預約 8080
            let fx = mk([], { env: { E2E_PORT_HOLD: 'parent' } })
            writeHolder(fx, 8080, { token: 'parent', known: [] })
            let h = reserve(fx, [8080, 9090], { tableAsync: (cb) => cb([rowOf(700)]) })
            assert.strict.equal(h.source, 'inherited')
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx, 8080), [700])
            assert.strict.equal(fs.existsSync(fileOf(fx, 9090)), false, '未預約之埠不建檔')
            //pinned: 同一行程再宣告新埠(extendActive 不預約新埠), 已預約之埠照寫
            let fx2 = mk([], { env: { E2E_PORT_OFFSET: '100' } })
            let h2 = reserve(fx2, [8080], { tableAsync: (cb) => cb([rowOf(704)]) })
            assert.strict.equal(h2.source, 'pinned')
            reserve(fx2, [9090], { tableAsync: (cb) => cb([rowOf(704)]) })
            assert.strict.deepEqual(h2.ports, [8180, 9190])
            assert.strict.deepEqual(await h2.noteOwn(childOf(704)), { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx2, 8180), [704])
            //auto: 全部屬本持有鏈
            let fx3 = mk()
            let h3 = reserve(fx3, [8080, 9090], { tableAsync: (cb) => cb([rowOf(708)]) })
            assert.strict.deepEqual(await h3.noteOwn(childOf(708)), { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual([knownPids(fx3, 8080), knownPids(fx3, 9090)], [[708], [708]])
        })

        it('[NO08c] basePorts 為空: 無預約檔可寫, 只記於記憶體, 回 recorded(killOwnListeners 仍依記憶體之身分)', async function() {
            let fx = mk()
            let h = reserve(fx, [], { tableAsync: (cb) => cb([rowOf(700)]) })
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: true, attempts: 1, reason: 'recorded' })
            assert.strict.deepEqual(regFiles(fx), [])
        })

        it('[NO09] 寫預約檔暫時失敗(重試後成功): 以 write-failed 重試; 用盡則 ok:false/write-failed、預約檔不被半寫', async function() {
            let fx = mk()
            let tmp = `${fileOf(fx, 8080)}.${process.pid}.tmp`
            //暫存檔之路徑被目錄占住: 寫入拋錯, 移除後即可
            fs.mkdirSync(tmp)
            let ev = []
            let h = reserve(fx, [8080], {
                tableAsync: (cb) => cb([rowOf(700)]),
                noteRetryMs: 1,
                onTrace: (e) => {
                    ev.push(e)
                    if (e.type === 'note-attempt' && e.attempt === 1) {
                        fs.rmSync(tmp, { recursive: true, force: true })
                    }
                },
            })
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: true, attempts: 2, reason: 'recorded' })
            assert.strict.deepEqual(noteEvs(ev).slice(0, 2).map((e) => [e.attempt, e.ok, e.reason]), [[1, false, 'write-failed'], [2, true, null]])
            assert.strict.deepEqual(knownPids(fx), [700])
            //用盡
            let fx2 = mk()
            let tmp2 = `${fileOf(fx2, 8080)}.${process.pid}.tmp`
            fs.mkdirSync(tmp2)
            let h2 = reserve(fx2, [8080], { tableAsync: (cb) => cb([rowOf(700)]), noteTries: 2, noteRetryMs: 1 })
            let before = fs.readFileSync(fileOf(fx2, 8080), 'utf8')
            assert.strict.deepEqual(await h2.noteOwn(childOf(700)), { ok: false, attempts: 2, reason: 'write-failed' })
            assert.strict.equal(fs.readFileSync(fileOf(fx2, 8080), 'utf8'), before)
            fs.rmSync(tmp2, { recursive: true, force: true })
        })

        it('[NO09b] 多埠時一個預約檔寫入一直失敗: ok:false/write-failed(不因另一個寫成而算成功); 已寫成之檔不回復', async function() {
            let fx = mk()
            let h = reserve(fx, [8080, 9090], { tableAsync: (cb) => cb([rowOf(700)]), noteTries: 2, noteRetryMs: 1 })
            let tmp = `${fileOf(fx, 9090)}.${process.pid}.tmp`
            fs.mkdirSync(tmp)
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: false, attempts: 2, reason: 'write-failed' })
            assert.strict.deepEqual(knownPids(fx, 8080), [700], '另一個檔已寫成, 不回復')
            assert.strict.deepEqual(knownPids(fx, 9090), [])
            fs.rmSync(tmp, { recursive: true, force: true })
        })

        it('[NO09c] 預約檔存在而讀不出(寫到一半、被占用)屬暫時性: 以 write-failed 重試, 恢復後記入; 一直讀不出則 ok:false/write-failed(不當成預約檔不存在)', async function() {
            let fx = mk()
            let fp = fileOf(fx, 8080)
            let orig = ''
            let h = reserve(fx, [8080], {
                tableAsync: (cb) => cb([rowOf(700)]),
                noteRetryMs: 1,
                onTrace: (e) => {
                    if (e.type === 'note-attempt' && e.attempt === 1) {
                        fs.writeFileSync(fp, orig)
                    }
                },
            })
            orig = fs.readFileSync(fp, 'utf8')
            fs.writeFileSync(fp, '{"token":')
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: true, attempts: 2, reason: 'recorded' })
            assert.strict.deepEqual(knownPids(fx), [700])
            //一直讀不出
            let fx2 = mk()
            let fp2 = fileOf(fx2, 8080)
            let h2 = reserve(fx2, [8080], { tableAsync: (cb) => cb([rowOf(700)]), noteTries: 2, noteRetryMs: 1 })
            fs.writeFileSync(fp2, '{"token":')
            assert.strict.deepEqual(await h2.noteOwn(childOf(700)), { ok: false, attempts: 2, reason: 'write-failed' })
            assert.strict.equal(fs.readFileSync(fp2, 'utf8'), '{"token":', '讀不出之檔不得被改寫')
        })

        it('[NO02e] tableAsync 為 async 函數而拒絕: 視為該次查詢失敗(不等到逾時)並攔下其 rejection, 重試後成功', async function() {
            let fx = mk()
            let n = 0
            let n0 = rejections.length
            let h = reserve(fx, [8080], {
                tableAsync: async (cb) => {
                    n++
                    if (n === 1) {
                        throw new Error('boom')
                    }
                    cb([rowOf(700)])
                },
                noteRetryMs: 1,
                noteTimeoutMs: 600000,
            })
            assert.strict.deepEqual(await h.noteOwn(childOf(700)), { ok: true, attempts: 2, reason: 'recorded' })
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(rejections.slice(n0), [], '被拒絕之 Promise 須被攔下')
        })

        it('[NO10] 取樣內部拋錯(行程表含非預期之列): ok:false/sample-error, 不重試、不 reject、不同步拋錯', async function() {
            let fx = mk()
            let calls = 0
            let tableAsync = (cb) => {
                calls++
                cb([null])
            }
            let h = reserve(fx, [8080], { tableAsync, noteRetryMs: 1 })
            let p
            assert.strict.doesNotThrow(() => {
                p = h.noteOwn(childOf(700))
            })
            assert.strict.deepEqual(await p, { ok: false, attempts: 1, reason: 'sample-error' })
            assert.strict.equal(calls, 1, '非暫時性失敗不重試')
        })

        it('[NO11] 取行程表懸置: 逾 noteTimeoutMs 視為該次失敗(table-timeout), 用盡後 ok:false; 其後才回調者被忽略(不重複解開、不改寫預約檔)', async function() {
            let fx = mk()
            let src = mkTableSource()
            let ev = []
            let h = reserve(fx, [8080], { tableAsync: src.fn, noteTimeoutMs: 5, noteRetryMs: 1, noteTries: 2, onTrace: (e) => ev.push(e) })
            let before = fs.readFileSync(fileOf(fx, 8080), 'utf8')
            let r = await h.noteOwn(childOf(700))
            assert.strict.deepEqual(r, { ok: false, attempts: 2, reason: 'table-timeout' })
            assert.strict.equal(src.calls.length, 2)
            let n = ev.length
            src.calls[0]([rowOf(700)])
            src.calls[1]([rowOf(700)])
            assert.strict.equal(ev.length, n, '逾時後才回調者不得再產生事件')
            assert.strict.equal(fs.readFileSync(fileOf(fx, 8080), 'utf8'), before)
        })

        it('[NO12] 重試間隔與逾時各取 noteRetryMs、noteTimeoutMs(假時鐘: 差 1 毫秒不觸發、到點觸發); 逾時後之重試再隔 noteRetryMs', async function() {
            let fx = mk()
            let src = mkTableSource()
            mock.timers.enable({ apis: ['setTimeout'] })
            let h = reserve(fx, [8080], { tableAsync: src.fn, noteRetryMs: 250, noteTimeoutMs: 800, noteTries: 3 })
            let p = h.noteOwn(childOf(700))
            assert.strict.equal(src.calls.length, 1)
            mock.timers.tick(799)
            assert.strict.equal(src.calls.length, 1, '逾時未到')
            mock.timers.tick(1)
            //第 1 次逾時 → 隔 noteRetryMs 重試
            mock.timers.tick(249)
            assert.strict.equal(src.calls.length, 1, '重試間隔未到')
            mock.timers.tick(1)
            assert.strict.equal(src.calls.length, 2)
            src.calls[1]([rowOf(700)])
            assert.strict.deepEqual(await p, { ok: true, attempts: 2, reason: 'recorded' })
        })

        it('[NO13] 選項非預期值改用預設(K3): noteTries 預設 3、noteRetryMs 預設 1000、noteTimeoutMs 預設 PORT_QUERY_TIMEOUT_MS; noteRetryMs 為 0 有效', async function() {
            //一律失敗(回 null)之行程表來源; count() 為嘗試次數
            let mkFailing = () => {
                let n = 0
                return {
                    count: () => n,
                    fn: (cb) => {
                        n++
                        cb(null)
                    },
                }
            }
            //noteTries 非正整數 → 3 次
            for (let bad of [0, -1, 1.5, 'x', null, NaN]) {
                let fx = mk()
                let src = mkFailing()
                let h = reserve(fx, [8080], { tableAsync: src.fn, noteTries: bad, noteRetryMs: 1 })
                let r = await h.noteOwn(childOf(700))
                assert.strict.deepEqual([r.ok, r.attempts, src.count()], [false, 3, 3], `noteTries=${String(bad)}`)
                handles.splice(0).forEach((x) => x.release())
            }
            //noteRetryMs 非有效非負數 → 1000
            for (let bad of [-1, 'x', null, NaN, Infinity]) {
                let fx = mk()
                let src = mkFailing()
                mock.timers.enable({ apis: ['setTimeout'] })
                let h = reserve(fx, [8080], { tableAsync: src.fn, noteRetryMs: bad })
                let p = h.noteOwn(childOf(700))
                assert.strict.equal(src.count(), 1)
                mock.timers.tick(999)
                assert.strict.equal(src.count(), 1, `noteRetryMs=${String(bad)} 未到預設 1000`)
                mock.timers.tick(1)
                assert.strict.equal(src.count(), 2, `noteRetryMs=${String(bad)} 到預設 1000`)
                mock.timers.tick(1000)
                assert.strict.deepEqual(await p, { ok: false, attempts: 3, reason: 'table-failed' })
                mock.timers.reset()
                handles.splice(0).forEach((x) => x.release())
            }
            //noteRetryMs 為 0 有效(不被換成 1000)
            {
                let fx = mk()
                let src = mkFailing()
                mock.timers.enable({ apis: ['setTimeout'] })
                let h = reserve(fx, [8080], { tableAsync: src.fn, noteRetryMs: 0 })
                let p = h.noteOwn(childOf(700))
                mock.timers.tick(1)
                assert.strict.equal(src.count(), 3, 'noteRetryMs=0 一個刻度內即把重試用完(預設 1000 時只會重試 0 次)')
                assert.strict.deepEqual(await p, { ok: false, attempts: 3, reason: 'table-failed' })
                mock.timers.reset()
                handles.splice(0).forEach((x) => x.release())
            }
            //noteTimeoutMs 非正整數 → PORT_QUERY_TIMEOUT_MS
            for (let bad of [0, -1, 1.5, 'x', null]) {
                let fx = mk()
                let ev = []
                mock.timers.enable({ apis: ['setTimeout'] })
                let h = reserve(fx, [8080], { tableAsync: () => {}, noteTimeoutMs: bad, noteTries: 1, onTrace: (e) => ev.push(e) })
                let p = h.noteOwn(childOf(700))
                mock.timers.tick(PORT_QUERY_TIMEOUT_MS - 1)
                assert.strict.equal(noteEvs(ev).length, 0, `noteTimeoutMs=${String(bad)} 未到預設逾時`)
                mock.timers.tick(1)
                assert.strict.deepEqual(await p, { ok: false, attempts: 1, reason: 'table-timeout' })
                mock.timers.reset()
                handles.splice(0).forEach((x) => x.release())
            }
        })

        it('[NO13b] 間隔與逾時之上限夾在計時器可用範圍內(超過 2^31-1 毫秒不得被計時器改為 1 毫秒)', async function() {
            let fx = mk()
            let src = mkTableSource()
            let n0 = warnings.length
            let h = reserve(fx, [8080], { tableAsync: src.fn, noteTimeoutMs: 1e12, noteRetryMs: 1e12 })
            let p = h.noteOwn(childOf(700))
            await src.reached(1)
            src.calls[0](null)
            //讓出, 使 process.emitWarning(nextTick)有機會送達
            await new Promise((resolve) => setImmediate(resolve))
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(warnings.slice(n0).filter((w) => w.name === 'TimeoutOverflowWarning').map((w) => w.message), [])
            assert.strict.equal(await isPending(p), true, '重試間隔夾在上限, 不得立即重試')
            assert.strict.equal(src.calls.length, 1)
        })

        it('[NO14] 不等待者(fire-and-forget): 取樣失敗、tableAsync 同步拋錯皆不拋錯、不產生 unhandled rejection; 事件仍告知', async function() {
            let fx = mk()
            let doneP = null
            let fails = []
            let gotFail = new Promise((resolve) => {
                doneP = resolve
            })
            let h = reserve(fx, [8080], {
                tableAsync: () => {
                    throw new Error('boom')
                },
                noteTries: 2,
                noteRetryMs: 1,
                onTrace: (e) => {
                    if (e.type === 'note-failed') {
                        fails.push(e.reason)
                        if (fails.length === 2) {
                            doneP()
                        }
                    }
                },
            })
            assert.strict.doesNotThrow(() => {
                h.noteOwn(childOf(700))
                h.noteOwn(null)
            })
            await gotFail
            assert.strict.deepEqual(fails, ['invalid-child', 'table-failed'])
            //讓出, 使任何 unhandled rejection 有機會被回報
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(rejections, [])
        })

        //[R4] createServiceManager 之 noteOwn 不阻塞服務就緒; 完成以 onTrace 之 own-noted 轉出
        it('[NO15] createServiceManager: 服務就緒不等 noteOwn 取樣; 取樣完成後以 own-noted 事件告知(service、port、pid、ok、attempts、reason)', async function() {
            let fx = mk()
            let src = mkTableSource()
            let h = reserve(fx, [19731], { tableAsync: src.fn })
            let ev = []
            let ready = false
            let onOwn = null
            let gotOwn = new Promise((resolve) => {
                onOwn = resolve
            })
            let sm = createServiceManager({
                ...smBase,
                reservation: h,
                onTrace: (e) => {
                    ev.push(e)
                    if (e.type === 'own-noted') {
                        onOwn(e)
                    }
                },
                probe: async () => ready,
                services: [{
                    name: 'a',
                    port: 19731,
                    spawn: () => {
                        ready = true
                        return childOf(4321)
                    },
                }],
            })
            //防懸置上限(真實計時器): 若管理器等了取樣, 取樣尚未回來, 就緒永不完成
            let guard
            let timeout = new Promise((resolve) => {
                guard = setTimeout(() => resolve('blocked'), 10000)
            })
            let r = await Promise.race([sm.startServersOnce().then(() => 'ready'), timeout])
            clearTimeout(guard)
            assert.strict.equal(r, 'ready', '服務就緒不得等 noteOwn 之取樣')
            await src.reached(1)
            assert.strict.deepEqual(ev.filter((e) => e.type === 'own-noted'), [], '取樣尚未完成, 無事件')
            src.calls[0]([rowOf(4321)])
            await gotOwn
            assert.strict.deepEqual(ev.filter((e) => e.type === 'own-noted').map((e) => ({ ...e })), [
                { type: 'own-noted', service: 'a', port: 19731, pid: 4321, ok: true, attempts: 1, reason: 'recorded' },
            ])
            assert.strict.deepEqual(knownPids(fx, 19731), [4321])
        })

        it('[NO15c] createServiceManager: restart 後之 noteOwn 亦以 own-noted 告知(新行程之 pid); 保留之 noteOwn 回傳被拒絕之 Promise 時不產生 unhandled rejection', async function() {
            let fx = mk()
            let h = reserve(fx, [19735], { tableAsync: (cb) => cb([rowOf(4321), rowOf(4323)]) })
            let got = []
            let onTwo = null
            let gotTwo = new Promise((resolve) => {
                onTwo = resolve
            })
            let ready = false
            let n = 0
            let sm = createServiceManager({
                ...smBase,
                reservation: h,
                onTrace: (e) => {
                    if (e.type === 'own-noted') {
                        got.push({ ...e })
                        if (got.length === 2) {
                            onTwo()
                        }
                    }
                },
                probe: async () => ready,
                services: [{
                    name: 'a',
                    port: 19735,
                    spawn: () => {
                        ready = true
                        return childOf(4321 + (n++ * 2))
                    },
                }],
            })
            await sm.startServersOnce()
            await sm.restart('a')
            await gotTwo
            assert.strict.deepEqual(got.map((e) => [e.service, e.port, e.pid, e.ok, e.reason]), [['a', 19735, 4321, true, 'recorded'], ['a', 19735, 4323, true, 'recorded']])
            //回傳被拒絕之 Promise 之假保留: 管理器不得因此產生 unhandled rejection(含未傳 onTrace 者)
            let n0 = rejections.length
            let ready2 = false
            let sm2 = createServiceManager({
                ...smBase,
                reservation: { source: 'auto', noteOwn: () => Promise.reject(new Error('x')), killOwnListeners: () => ({ pids: [], killed: [], skipped: [] }) },
                probe: async () => ready2,
                services: [{
                    name: 'b',
                    port: 19736,
                    spawn: () => {
                        ready2 = true
                        return childOf(4324)
                    },
                }],
            })
            await sm2.startServersOnce()
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(rejections.slice(n0), [])
        })

        it('[NO15b] createServiceManager: 取樣用盡失敗時 own-noted 如實告知(ok:false、attempts、reason), 服務照常就緒; 假保留(noteOwn 不回 Promise)不發此事件', async function() {
            let fx = mk()
            let h = reserve(fx, [19732], { tableAsync: (cb) => cb(null), noteTries: 2, noteRetryMs: 1 })
            let onOwn = null
            let gotOwn = new Promise((resolve) => {
                onOwn = resolve
            })
            let mkSm = (reservation, port, onTrace) => {
                let ready = false
                return createServiceManager({
                    ...smBase,
                    reservation,
                    onTrace,
                    probe: async () => ready,
                    services: [{
                        name: 'a',
                        port,
                        spawn: () => {
                            ready = true
                            return childOf(4322)
                        },
                    }],
                })
            }
            await mkSm(h, 19732, (e) => {
                if (e.type === 'own-noted') {
                    onOwn(e)
                }
            }).startServersOnce()
            let e = await gotOwn
            assert.strict.deepEqual({ ...e }, { type: 'own-noted', service: 'a', port: 19732, pid: 4322, ok: false, attempts: 2, reason: 'table-failed' })
            assert.strict.deepEqual(knownPids(fx, 19732), [], '失敗不寫入')
            //假保留(回傳非 Promise)與回傳怪值者: 不發事件、不拋錯
            let ev = []
            let notes = []
            await mkSm({ source: 'auto', noteOwn: (c) => notes.push(c), killOwnListeners: () => ({ pids: [], killed: [], skipped: [] }) }, 19733, (x) => ev.push(x)).startServersOnce()
            await mkSm({ source: 'auto', noteOwn: () => Promise.resolve('x'), killOwnListeners: () => ({ pids: [], killed: [], skipped: [] }) }, 19734, (x) => ev.push(x)).startServersOnce()
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(notes.length, 1)
            assert.strict.deepEqual(ev.filter((x) => x.type === 'own-noted').map((x) => ({ ...x })), [
                { type: 'own-noted', service: 'a', port: 19734, pid: 4322, ok: false, attempts: null, reason: null },
            ])
        })

    })

    describe('createServiceManager 已導入時', function() {

        //假保留: 只驗管理器之分流, 保留本身已於上方驗證
        let fakeRes = (over = {}) => {
            let notes = []
            return {
                notes,
                source: 'auto',
                noteOwn: (c) => notes.push(c),
                killOwnListeners: () => ({ pids: [], killed: [], skipped: [] }),
                ...over,
            }
        }
        let mkChild = (pid = 0) => (pid ? { pid, exitCode: null, signalCode: null } : {})
        //假 child 沒有真實行程; 就緒核對另見 unit-serviceOwner、api-serviceOwner
        let baseOpt = { pollMs: 1, portReleaseTimeoutMs: 5, portReleasePollMs: 1, sleep: async () => {}, killTree: () => {}, verifyOwner: async () => {}, log: () => {} }

        //E5: 偵測與綁定之間被搶走
        it('[PR80] 本行程保留後埠有回應(尚未啟動過): 拋錯不沿用、不 spawn; 未導入與上層保留者照舊沿用', async function() {
            let spawned = 0
            let mkSm = (res) => createServiceManager({
                ...baseOpt,
                reservation: res,
                probe: async () => true,
                services: [{
                    name: 'a',
                    port: 19711,
                    spawn: () => {
                        spawned++
                        return mkChild()
                    }
                }],
            })
            await assert.rejects(mkSm(fakeRes()).startServersOnce(), /保留後被他人占用.*不沿用、不下殺/s)
            assert.strict.equal(spawned, 0)
            await mkSm(fakeRes({ source: 'inherited' })).startServersOnce()
            await mkSm(fakeRes({ source: 'pinned' })).startServersOnce()
            assert.strict.equal(spawned, 0)
        })

        it('[PR81] 啟動過之服務再次 startServersOnce 而埠有回應: 照舊沿用(cleanup 後舊實例片刻才結束)', async function() {
            let ready = false
            let sm = createServiceManager({
                ...baseOpt,
                reservation: fakeRes(),
                probe: async () => ready,
                services: [{
                    name: 'a',
                    port: 19712,
                    spawn: () => {
                        ready = true
                        return mkChild(1234)
                    }
                }],
            })
            await sm.startServersOnce()
            sm.cleanup()
            await sm.startServersOnce()
            assert.strict.equal(sm.state('a').attempted, true)
        })

        it('[PR82] 服務就緒後記入保留; restart 亦同', async function() {
            let ready = false
            let res = fakeRes()
            let n = 0
            let sm = createServiceManager({
                ...baseOpt,
                reservation: res,
                probe: async () => ready,
                services: [{
                    name: 'a',
                    port: 19713,
                    spawn: () => {
                        ready = true
                        return mkChild(++n + 100)
                    }
                }],
            })
            await sm.startServersOnce()
            assert.strict.deepEqual(res.notes.map((c) => c.pid), [101])
            await sm.restart('a')
            assert.strict.deepEqual(res.notes.map((c) => c.pid), [101, 102])
        })

        it('[PR83] 服務於就緒前結束: 立即拋錯, 不等到逾時; 未導入者照舊等到逾時', async function() {
            let sm = createServiceManager({
                ...baseOpt,
                reservation: fakeRes(),
                probe: async () => false,
                services: [{ name: 'a', port: 19714, readyTimeoutMs: 3000, spawn: () => ({ pid: 999, exitCode: 1, signalCode: null }) }],
            })
            await assert.rejects(sm.startServersOnce(), /於就緒前結束\(離開碼 1\)/)
            let sm2 = createServiceManager({
                ...baseOpt,
                probe: async () => false,
                services: [{ name: 'a', port: 19715, readyTimeoutMs: 20, spawn: () => ({ pid: 999, exitCode: 1, signalCode: null }) }],
            })
            await assert.rejects(sm2.startServersOnce(), /server not ready on port 19715/)
        })

        //E4: restart 要殺非自建之監聽者時
        it('[PR84] restart(無自建行程、埠有回應、允許殺外部): 只經 killOwnListeners, 不呼叫依埠下殺; 非本實例者拋錯寫明', async function() {
            let killedByPort = []
            let probeOn = true
            let called = []
            let sm = (res) => createServiceManager({
                ...baseOpt,
                reservation: res,
                killForeignOnRestart: true,
                killListeners: (p) => {
                    killedByPort.push(p)
                    return { pids: [], killed: [] }
                },
                probe: async () => probeOn,
                services: [{ name: 'a', port: 19716, spawn: () => mkChild(555) }],
            })
            await assert.rejects(sm(fakeRes({
                killOwnListeners: (p) => {
                    called.push(p)
                    return { pids: ['4321'], killed: [], skipped: ['4321'] }
                }
            })).restart('a'), /restart a: port 19716 被非本實例之行程占用.*不下殺/s)
            assert.strict.deepEqual(called, [19716])
            assert.strict.deepEqual(killedByPort, [], '已導入者不得依埠下殺')
            //身分已確認者已殺: 繼續 spawn
            probeOn = true
            let n = 0
            let res = fakeRes({
                killOwnListeners: () => {
                    n++
                    return { pids: ['4321'], killed: ['4321'], skipped: [] }
                }
            })
            await sm(res).restart('a')
            assert.strict.equal(n, 1)
            assert.strict.deepEqual(res.notes.map((c) => c.pid), [555])
            //未導入: 照舊依埠下殺
            await sm(null).restart('a')
            assert.strict.deepEqual(killedByPort, [19716])
        })

    })

})
