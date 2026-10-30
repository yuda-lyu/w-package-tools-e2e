import assert from 'assert'
import net from 'net'
import cp, { spawn } from 'child_process'
import { syncBuiltinESMExports } from 'module'
import { EventEmitter } from 'events'
import listenerPids from '../src/listenerPids.mjs'
import isChildAlive from '../src/isChildAlive.mjs'
import waitChildExit from '../src/waitChildExit.mjs'
import pidExists from '../src/pidExists.mjs'
import sleepSync from '../src/sleepSync.mjs'
import killOwnTree from '../src/killOwnTree.mjs'
import killPortListeners from '../src/killPortListeners.mjs'
import { psOut, ok, err, THROW, fakeExec } from './tools/portPidsFake.mjs'


//行程原語之單元測試(不需server/browser, 以注入之假依賴執行; 另有[真實]案以本機真實子指令與子程序驗證)
//isChildAlive/waitChildExit/pidExists/killOwnTree之案例移植自w-web-task test/unit-harnessProc.test.mjs
//listenerPids/killPortListeners委由wsemi execProcessPortPidsSync查詢(2026-10-30起), 其注入點為spawnSync形(prog, args, { src, timeout, maxBuffer })=>{ status, stdout, error };
//  規格(任務〈要做的事〉與JSDoc): ①判定不依狀態欄(對外連線之狀態錯置為LISTENING不得誤判); ②Windows先netstat、查無或失敗再以Get-NetTCPConnection確認, 其查無才判無人;
//  ③查詢失敗回null(非[]); ④useBoth/timeout/onTrace透傳; ⑤killPortListeners查詢傳useBoth:true; ⑥對外之PID為字串


//netstat -ano樣本(資料列取自實測格式; 表頭於中文Windows為cp950在地化文字, 以utf8讀入即為亂碼)
let NETSTAT = [
    '',
    '������',
    '',
    '  ���   ��������               ������               ����            PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1412',
    '  TCP    0.0.0.0:11108          0.0.0.0:0              LISTENING       15816',
    '  TCP    0.0.0.0:21108          0.0.0.0:0              LISTENING       2222',
    '  TCP    127.0.0.1:53211        127.0.0.1:11108        ESTABLISHED     3333',
    '  TCP    127.0.0.1:11108        127.0.0.1:53211        ESTABLISHED     15816',
    '  TCP    [::]:11108             [::]:0                 LISTENING       15816',
    '  TCP    [::1]:8091             [::]:0                 LISTENING       4444',
    '  TCP    [fe80::1%12]:9100      [::]:0                 LISTENING       6666',
    '  TCP    0.0.0.0:9200           0.0.0.0:0              ABHÖREN         7777',
    '  UDP    0.0.0.0:11108          *:*                                    5555',
].join('\r\n')


//假child: 只帶isChildAlive/killOwnTree用得到之欄位
let fakeChild = (o = {}) => {
    let c = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, killed: [], ...o })
    c.kill = (sig) => {
        c.killed.push(sig)
    }
    return c
}


//記錄呼叫之假exec
let makeExec = (impl) => {
    let calls = []
    let opts = []
    let exec = (cmd, opt) => {
        calls.push(cmd)
        opts.push(opt)
        return impl(cmd, opt)
    }
    return { exec, calls, opts }
}


//對外連線之netstat列(本地埠50000為對外連線之臨時埠, 無人監聽), 狀態被系統錯置為LISTENING(主控經驗: 本機/SEMI-WIN-DEV2 Windows 11 26300之netstat行為)
let OUTBOUND = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:50000        93.184.216.34:443      LISTENING       7000',
    '  TCP    0.0.0.0:135            0.0.0.0:0              FIN_WAIT_1      1356',
].join('\r\n')

//目標port整列缺漏之netstat輸出(他port有列; netstat漏列新起之監聽之異常形)
let NS_MISSING = NETSTAT.split('\r\n').filter((l) => !l.includes(':11108 ') && !l.includes(':11108\t')).join('\r\n')


describe('listenerPids', function() {

    it('[LP01] win32: netstat -ano查到即採用(IPv4與IPv6同一PID去重), 不再查PowerShell, 回字串, 子指令帶逾時', function() {
        //規格⑥: 對外之PID為字串; 規格②: netstat查到即採用
        let calls = []
        let r = listenerPids(11108, { exec: fakeExec({ netstat: ok(NETSTAT) }, calls), platform: 'win32' })
        assert.strict.deepStrictEqual(r, ['15816'])
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat'])
        assert.strict.ok(calls[0].timeout > 0)
        assert.strict.ok(!calls[0].args.includes('-p'), 'netstat不得加-p TCP(只列IPv4會漏掉以::雙堆疊監聽者)')
    })

    it('[LP02] win32: 外部位址為:port之連線列、其他port、UDP列皆不算', function() {
        //規格①: 只看本地埠相符且遠端為萬用位址之TCP列
        let r = listenerPids(11108, { exec: fakeExec({ netstat: ok(NETSTAT) }, []), platform: 'win32' })
        assert.strict.ok(!r.includes('3333'))
        assert.strict.ok(!r.includes('2222'))
        assert.strict.ok(!r.includes('5555'))
    })

    it('[LP03] win32: IPv6迴路位址、zone id、在地化狀態字(ABHÖREN)皆取得到(判定不依狀態欄)', function() {
        //規格①: 不依狀態欄
        let exec = fakeExec({ netstat: ok(NETSTAT) }, [])
        assert.strict.deepStrictEqual(listenerPids(8091, { exec, platform: 'win32' }), ['4444'])
        assert.strict.deepStrictEqual(listenerPids(9100, { exec, platform: 'win32' }), ['6666'])
        assert.strict.deepStrictEqual(listenerPids(9200, { exec, platform: 'win32' }), ['7777'])
    })

    it('[LP04] win32: 監聽列之狀態被系統錯置(FIN_WAIT_1)仍判為監聽(只看遠端為萬用位址)', function() {
        //規格①: 本機實測 135 埠之狀態字為 FIN_WAIT_1 而 PID 1356 確為監聽者
        let calls = []
        let r = listenerPids(135, { exec: fakeExec({ netstat: ok(OUTBOUND) }, calls), platform: 'win32' })
        assert.strict.deepStrictEqual(r, ['1356'])
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat'])
    })

    it('[LP05] win32: 對外連線之狀態錯置為LISTENING不得誤判為監聽(PowerShell確認無人 => [])', function() {
        //規格①: 遠端為對端位址(非萬用位址)者不是監聽列, 即使狀態欄寫LISTENING; 規格②: netstat查無時以Get-NetTCPConnection確認
        let calls = []
        let r = listenerPids(50000, { exec: fakeExec({ netstat: ok(OUTBOUND), powershell: ok(psOut([])) }, calls), platform: 'win32' })
        assert.strict.deepStrictEqual(r, [])
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat', 'powershell'])
    })

    it('[LP06] win32: netstat整列漏列而Get-NetTCPConnection有 => 以PowerShell結果為準', function() {
        //規格②: netstat漏列(本機實測自起之監聽 netstat 0/10 列出)時以 Get-NetTCPConnection -LocalPort 確認
        let calls = []
        let r = listenerPids(11108, { exec: fakeExec({ netstat: ok(NS_MISSING), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816]])) }, calls), platform: 'win32' })
        assert.strict.deepStrictEqual(r, ['15816'])
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat', 'powershell'])
        assert.strict.ok(NS_MISSING.includes(':11108') === false, '前置: 夾具之netstat輸出確實不含目標port')
    })

    it('[LP07] win32: netstat與PowerShell皆查無才回[](已確認無人), 空輸出/無此port亦同', function() {
        //規格②③: [] 只代表已確認無人
        for (let ns of [NS_MISSING, NETSTAT, '']) {
            let calls = []
            let r = listenerPids(9999, { exec: fakeExec({ netstat: ok(ns), powershell: ok(psOut([])) }, calls), platform: 'win32' })
            assert.strict.deepStrictEqual(r, [])
            assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat', 'powershell'])
        }
    })

    it('[LP08] win32: 查詢失敗回null, 絕不回[](指令不存在/逾時/離開碼非0/無法解析/拋錯/回傳非物件)', function() {
        //規格③: 失敗與無人嚴格分開, 呼叫端不得把null當成無人
        let fails = [
            { netstat: err('ENOENT'), powershell: err('ENOENT') },
            { netstat: ok(NS_MISSING), powershell: err('ENOENT') },
            { netstat: ok(NS_MISSING), powershell: err('ETIMEDOUT') },
            { netstat: ok(NS_MISSING), powershell: ok('', 3) },
            { netstat: ok(NS_MISSING), powershell: ok('') }, //無標記=無法解析
            { netstat: ok(NS_MISSING), powershell: THROW },
            { netstat: THROW, powershell: THROW },
            { netstat: ok(NS_MISSING), powershell: 'abc' }, //回傳非物件
        ]
        for (let outs of fails) {
            let r = listenerPids(11108, { exec: fakeExec(outs, []), platform: 'win32' })
            assert.strict.deepStrictEqual(r, null, JSON.stringify(Object.keys(outs).map((k) => [k, outs[k] === THROW ? 'THROW' : typeof outs[k]])))
        }
    })

    it('[LP09] win32: netstat失敗但PowerShell查到 => 以PowerShell為準(netstat不單獨決定無人)', function() {
        //規格②: 最終之「無人」永遠由 Get-NetTCPConnection 確認
        let r = listenerPids(11108, { exec: fakeExec({ netstat: err('ENOENT'), powershell: ok(psOut([[11108, '::', 0, 15816]])) }, []), platform: 'win32' })
        assert.strict.deepStrictEqual(r, ['15816'])
    })

    it('[LP10] useBoth透傳: 兩者皆查並取聯集(去重、排序); 未傳時netstat有列即不查PowerShell', function() {
        //規格④: useBoth為身分確認用, netstat有列出時預設不再查PowerShell, 故可能只得部分監聽者
        let outs = { netstat: ok(NETSTAT), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816], [11108, '::', 0, 16000]])) }
        let c1 = []
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec(outs, c1), platform: 'win32', useBoth: true }), ['15816', '16000'])
        assert.strict.deepStrictEqual(c1.map((c) => c.src), ['netstat', 'powershell'])
        let c2 = []
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec(outs, c2), platform: 'win32' }), ['15816'])
        assert.strict.deepStrictEqual(c2.map((c) => c.src), ['netstat'])
        let c3 = []
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec(outs, c3), platform: 'win32', useBoth: false }), ['15816'])
        assert.strict.deepStrictEqual(c3.map((c) => c.src), ['netstat'])
    })

    it('[LP11] useBoth時PowerShell失敗 => null(不以netstat之部分結果代替)', function() {
        //規格③④: 身分確認要完整集合, 取不到完整集合即失敗
        let r = listenerPids(11108, { exec: fakeExec({ netstat: ok(NETSTAT), powershell: err('ETIMEDOUT') }, []), platform: 'win32', useBoth: true })
        assert.strict.deepStrictEqual(r, null)
    })

    it('[LP12] timeout透傳至每個子指令(含小數進位); 未傳為正數預設', function() {
        //規格④: exit/signal處理器內之呼叫須能給較短逾時
        let c1 = []
        listenerPids(11108, { exec: fakeExec({ netstat: ok(NS_MISSING), powershell: ok(psOut([])) }, c1), platform: 'win32', timeout: 1234 })
        assert.strict.deepStrictEqual(c1.map((c) => c.timeout), [1234, 1234])
        let c2 = []
        listenerPids(11108, { exec: fakeExec({ netstat: ok(NS_MISSING), powershell: ok(psOut([])) }, c2), platform: 'win32', timeout: 1234.5 })
        assert.strict.deepStrictEqual(c2.map((c) => c.timeout), [1235, 1235])
        let c3 = []
        listenerPids(11108, { exec: fakeExec({ netstat: ok(NS_MISSING), powershell: ok(psOut([])) }, c3), platform: 'win32' })
        assert.strict.ok(c3.every((c) => c.timeout > 0))
    })

    it('[LP13] onTrace透傳: 事件含實際走哪條資料來源, 失敗訊息可由settle事件之msg取得', function() {
        //規格④: 同步版之失敗訊息只經 onTrace 的 settle.msg 取得
        let evs = []
        listenerPids(11108, { exec: fakeExec({ netstat: ok(NS_MISSING), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816]])) }, []), platform: 'win32', onTrace: (e) => evs.push(e) })
        let st = evs[evs.length - 1]
        assert.strict.deepStrictEqual([st.type, st.ok, st.src], ['settle', true, 'powershell'])
        let evs2 = []
        listenerPids(11108, { exec: fakeExec({ netstat: ok(NS_MISSING), powershell: err('ETIMEDOUT') }, []), platform: 'win32', onTrace: (e) => evs2.push(e) })
        let st2 = evs2[evs2.length - 1]
        assert.strict.deepStrictEqual([st2.type, st2.ok], ['settle', false])
        assert.strict.ok(/powershell timeout/.test(st2.msg), st2.msg)
    })

    it('[LP14] port不合法 => null且不起任何子指令', function() {
        //規格③: 輸入不合法為失敗而非無人
        for (let p of [0, -1, 65536, 1.5, 'abc', '', null, undefined, {}, NaN]) {
            let calls = []
            assert.strict.deepStrictEqual(listenerPids(p, { exec: fakeExec({}, calls), platform: 'win32' }), null, String(p))
            assert.strict.deepStrictEqual(calls, [], String(p))
        }
    })

    it('[LP15] posix: lsof輸出之PID去重排序成字串; 離開碼1(查無)回[]; 其他失敗回null', function() {
        //規格②③: Linux/macOS 走 lsof, 離開碼1=無人, 其餘失敗
        let calls = []
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec({ lsof: ok('456\n123\n456\n') }, calls), platform: 'linux' }), ['123', '456'])
        assert.strict.deepStrictEqual(calls.map((c) => [c.src, c.prog]), [['lsof', 'lsof']])
        assert.strict.ok(calls[0].args.join(' ').includes('11108'))
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec({ lsof: ok('', 1) }, []), platform: 'darwin' }), [])
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec({ lsof: ok('', 127) }, []), platform: 'linux' }), null)
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec({ lsof: err('ENOENT') }, []), platform: 'linux' }), null)
        assert.strict.deepStrictEqual(listenerPids(11108, { exec: fakeExec({ lsof: THROW }, []), platform: 'linux' }), null)
    })

})


describe('listenerPids [真實] 本機真實子指令與真實監聽', function() {

    //固定埠(>=8000, 不隨機); 兩埠須空閒, 否則該條失敗並註明
    let PORT = 19050

    let listenOn = async (host) => {
        let srv = net.createServer()
        await new Promise((resolve, reject) => {
            srv.once('error', (e) => reject(new Error(`測試埠${PORT}無法監聽(${e.code}): 須空閒`)))
            srv.listen(PORT, host, resolve)
        })
        return srv
    }
    let closeSrv = (srv) => new Promise((resolve) => srv.close(resolve))

    it('[RP01] 起監聽(0.0.0.0): listenerPids查得到自己, useBoth亦然; 關閉後回[](本機走備援, 事件記錄走哪條路)', async function() {
        this.timeout(60000)
        //規格②: netstat 漏列新起之監聽時, 以 Get-NetTCPConnection 確認; 修前碼在本機連續 5 次查詢前 3 次回 [](e2e01 報告「修前紅」)
        let srv = await listenOn('0.0.0.0')
        try {
            let evs = []
            let r = listenerPids(PORT, { onTrace: (e) => evs.push(e), timeout: 20000 })
            if (r === null && process.platform !== 'win32') {
                return this.skip() //非Windows且無lsof: 查詢工具不可用
            }
            assert.strict.deepStrictEqual(r, [String(process.pid)], `settle=${JSON.stringify(evs[evs.length - 1])}`)
            //走哪條路: 本機 netstat 漏列則 powershell, netstat 有列則 netstat; 兩者皆屬正確
            let src = evs[evs.length - 1].src
            console.log(`      [RP01] 路徑=${src}`)
            assert.strict.ok(['netstat', 'powershell', 'netstat+powershell', 'lsof'].includes(src), src)
            //useBoth: 完整集合
            assert.strict.deepStrictEqual(listenerPids(PORT, { useBoth: true, timeout: 20000 }), [String(process.pid)])
        }
        finally {
            await closeSrv(srv)
        }
        //關閉後: 已確認無人
        assert.strict.deepStrictEqual(listenerPids(PORT, { timeout: 20000 }), [])
    })

    it('[RP02] 起監聽(IPv6 ::): listenerPids查得到自己', async function() {
        this.timeout(60000)
        //規格①: IPv6雙堆疊監聽者不得漏(netstat 不可加 -p TCP)
        let srv = null
        try {
            srv = await listenOn('::')
        }
        catch (e) {
            if (/EAFNOSUPPORT|EADDRNOTAVAIL/.test(String(e && e.message))) {
                return this.skip() //無IPv6之主機
            }
            throw e
        }
        try {
            let r = listenerPids(PORT, { useBoth: true, timeout: 20000 })
            if (r === null && process.platform !== 'win32') {
                return this.skip()
            }
            assert.strict.deepStrictEqual(r, [String(process.pid)])
        }
        finally {
            await closeSrv(srv)
        }
    })

})


describe('isChildAlive/waitChildExit/pidExists/sleepSync', function() {

    it('isChildAlive: exitCode與signalCode皆為null才算存活', function() {
        assert.strict.deepStrictEqual(isChildAlive(fakeChild()), true)
        assert.strict.deepStrictEqual(isChildAlive(fakeChild({ exitCode: 0 })), false)
        assert.strict.deepStrictEqual(isChildAlive(fakeChild({ signalCode: 'SIGKILL' })), false)
        assert.strict.deepStrictEqual(isChildAlive(null), false)
    })

    it('waitChildExit: 已結束者立即true; 存活者待exit事件; 逾時回false且不留listener', async function() {
        assert.strict.deepStrictEqual(await waitChildExit(fakeChild({ exitCode: 0 }), 50), true)
        let c = fakeChild()
        setTimeout(() => {
            c.exitCode = 1
            c.emit('exit', 1, null)
        }, 30)
        assert.strict.deepStrictEqual(await waitChildExit(c, 1000), true)
        let d = fakeChild()
        assert.strict.deepStrictEqual(await waitChildExit(d, 50), false)
        assert.strict.deepStrictEqual(d.listenerCount('exit'), 0)
    })

    it('pidExists: kill(pid,0)成功為存在、ESRCH為不存在、EPERM為存在(無權限)', function() {
        assert.strict.deepStrictEqual(pidExists(1, { kill: () => true }), true)
        assert.strict.deepStrictEqual(pidExists(1, {
            kill: () => {
                throw Object.assign(new Error('x'), { code: 'ESRCH' })
            },
        }), false)
        assert.strict.deepStrictEqual(pidExists(1, {
            kill: () => {
                throw Object.assign(new Error('x'), { code: 'EPERM' })
            },
        }), true)
        assert.strict.deepStrictEqual(pidExists(process.pid), true)
    })

    it('sleepSync: 同步阻塞約指定毫秒', function() {
        let t0 = Date.now()
        sleepSync(120)
        let dt = Date.now() - t0
        assert.strict.ok(dt >= 100, `實際${dt}ms`)
    })

})


describe('killOwnTree', function() {

    it('已結束或無PID之child不下殺', function() {
        let { exec, calls } = makeExec(() => '')
        assert.strict.deepStrictEqual(killOwnTree(fakeChild({ exitCode: 0 }), { exec, platform: 'win32' }), false)
        assert.strict.deepStrictEqual(killOwnTree(fakeChild({ pid: undefined }), { exec, platform: 'win32' }), false)
        assert.strict.deepStrictEqual(calls, [])
    })

    it('win32: 存活者以同步taskkill /F /T /PID殺整棵樹, 且帶逾時', function() {
        let { exec, calls, opts } = makeExec(() => '')
        assert.strict.deepStrictEqual(killOwnTree(fakeChild({ pid: 777 }), { exec, platform: 'win32' }), true)
        assert.strict.deepStrictEqual(calls, ['taskkill /F /T /PID 777'])
        assert.strict.ok(opts[0].timeout > 0)
    })

    it('win32: taskkill失敗不拋錯(由呼叫端回驗)', function() {
        let { exec } = makeExec(() => {
            throw new Error('128')
        })
        assert.strict.deepStrictEqual(killOwnTree(fakeChild(), { exec, platform: 'win32' }), true)
    })

    it('posix: 先殺行程群組, 失敗再退回child.kill(SIGKILL)', function() {
        let groups = []
        let ok = fakeChild({ pid: 55 })
        killOwnTree(ok, {
            platform: 'linux',
            killGroup: (pid) => {
                groups.push(pid)
            },
        })
        assert.strict.deepStrictEqual(groups, [55])
        assert.strict.deepStrictEqual(ok.killed, [])
        let fallback = fakeChild({ pid: 66 })
        killOwnTree(fallback, {
            platform: 'linux',
            killGroup: () => {
                throw new Error('ESRCH')
            },
        })
        assert.strict.deepStrictEqual(fallback.killed, ['SIGKILL'])
    })

})


describe('killPortListeners', function() {

    //查詢成功之固定輸出: netstat查到15816, taskkill成功
    let OUTS = () => ({ netstat: ok(NETSTAT), taskkill: ok('') })

    it('[KP01] win32: 殺全部監聽者(IPv4/IPv6去重後各一次), 不殺連線列之PID; 以taskkill /F /T /PID下殺', function() {
        //規格: 政策原語, 只殺監聽者與其行程樹; 規格⑤: 查詢傳useBoth:true(netstat有列時仍再查PowerShell)
        let calls = []
        let r = killPortListeners(11108, { exec: fakeExec({ ...OUTS(), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816]])) }, calls), platform: 'win32', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: ['15816'], killed: ['15816'] })
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat', 'powershell', 'taskkill'])
        assert.strict.deepStrictEqual([calls[2].prog, calls[2].args], ['taskkill', ['/F', '/T', '/PID', '15816']])
    })

    it('[KP02] 查詢傳useBoth:true: netstat漏列之監聽者(僅Get-NetTCPConnection查得)亦一併下殺', function() {
        //規格⑤: 殺行程要完整集合, 不接受netstat漏列之部分結果
        let calls = []
        let outs = { netstat: ok(NETSTAT), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816], [11108, '::', 0, 16000]])), taskkill: ok('') }
        let r = killPortListeners(11108, { exec: fakeExec(outs, calls), platform: 'win32', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: ['15816', '16000'], killed: ['15816', '16000'] })
        assert.strict.deepStrictEqual(calls.filter((c) => c.src === 'taskkill').map((c) => c.args[3]), ['15816', '16000'])
    })

    it('[KP03] exclude內之PID不殺(預設排除本行程)', function() {
        let calls = []
        let r = killPortListeners(11108, { exec: fakeExec({ ...OUTS(), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816]])) }, calls), platform: 'win32', exclude: [15816] })
        assert.strict.deepStrictEqual(r, { pids: ['15816'], killed: [] })
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat', 'powershell'])
        //預設exclude=[process.pid]: 監聽者為本行程時不殺
        let calls2 = []
        let ps = psOut([[11108, '0.0.0.0', 0, process.pid]])
        let ns = `  TCP    0.0.0.0:11108          0.0.0.0:0              LISTENING       ${process.pid}`
        let r2 = killPortListeners(11108, { exec: fakeExec({ netstat: ok(ns), powershell: ok(ps), taskkill: ok('') }, calls2), platform: 'win32' })
        assert.strict.deepStrictEqual(r2, { pids: [String(process.pid)], killed: [] })
        assert.strict.ok(!calls2.some((c) => c.src === 'taskkill'))
    })

    it('[KP04] 無監聽者: 不下殺(netstat與PowerShell皆查無)', function() {
        let calls = []
        assert.strict.deepStrictEqual(killPortListeners(9999, { exec: fakeExec({ ...OUTS(), powershell: ok(psOut([])) }, calls), platform: 'win32', exclude: [] }), { pids: [], killed: [] })
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['netstat', 'powershell'])
    })

    it('[KP05] 對外連線之狀態錯置為LISTENING: 不誤判為監聽者, 不誤殺不相干之PID', function() {
        //規格①: 修前碼對此輸出回 pids:['7000'] 並下殺 taskkill /F /T /PID 7000(e2e01 報告「修前紅」)
        let calls = []
        let r = killPortListeners(50000, { exec: fakeExec({ netstat: ok(OUTBOUND), powershell: ok(psOut([])), taskkill: ok('') }, calls), platform: 'win32', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: [], killed: [] })
        assert.strict.ok(!calls.some((c) => c.src === 'taskkill'), '不得下殺')
    })

    it('[KP06] 查詢失敗: 回pids:null且不下殺(不當成無人)', function() {
        //規格③: 失敗與無人分開
        let calls = []
        let r = killPortListeners(11108, { exec: fakeExec({ netstat: err('ENOENT'), powershell: err('ENOENT'), taskkill: ok('') }, calls), platform: 'win32', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: null, killed: [] })
        assert.strict.ok(!calls.some((c) => c.src === 'taskkill'))
        //useBoth下PowerShell失敗即整體失敗, 即使netstat已查到
        let calls2 = []
        let r2 = killPortListeners(11108, { exec: fakeExec({ netstat: ok(NETSTAT), powershell: err('ETIMEDOUT'), taskkill: ok('') }, calls2), platform: 'win32', exclude: [] })
        assert.strict.deepStrictEqual(r2, { pids: null, killed: [] })
        assert.strict.ok(!calls2.some((c) => c.src === 'taskkill'))
    })

    it('[KP07] posix: 以kill -9(經sh)殺lsof查得之PID', function() {
        let calls = []
        let r = killPortListeners(11007, { exec: fakeExec({ lsof: ok('321\n'), kill: ok('') }, calls), platform: 'linux', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: ['321'], killed: ['321'] })
        assert.strict.deepStrictEqual(calls.map((c) => c.src), ['lsof', 'kill'])
        assert.strict.deepStrictEqual([calls[1].prog, calls[1].args], ['sh', ['-c', 'kill -9 "$1"', 'sh', '321']])
    })

    it('[KP08] 下殺失敗(離開碼非0/無法啟動/拋錯; 已結束或無權限)不拋錯, 不列入killed', function() {
        let errWith0 = { status: 0, stdout: '', error: new Error('spawn x EPERM') } //矛盾形: 有error即視為失敗
        for (let kill of [ok('', 128), err('ENOENT'), err('ETIMEDOUT'), errWith0, THROW, 'abc', null]) {
            let outs = { netstat: ok(NETSTAT), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816]])), taskkill: kill }
            if (kill === null) {
                outs.taskkill = undefined //fakeExec對未列src拋錯
            }
            let r = killPortListeners(11108, { exec: fakeExec(outs, []), platform: 'win32', exclude: [] })
            assert.strict.deepStrictEqual(r, { pids: ['15816'], killed: [] }, String(kill && kill.status))
        }
    })

    it('[KP09] timeout透傳至查詢與下殺之每個子指令(小數進位; 非數字/非正數為預設10000)', function() {
        let run = (timeout) => {
            let calls = []
            killPortListeners(11108, { exec: fakeExec({ ...OUTS(), powershell: ok(psOut([[11108, '0.0.0.0', 0, 15816]])) }, calls), platform: 'win32', exclude: [], timeout })
            return calls.map((c) => c.timeout)
        }
        assert.strict.deepStrictEqual(run(2500), [2500, 2500, 2500])
        assert.strict.deepStrictEqual(run(2500.2), [2501, 2501, 2501])
        assert.strict.deepStrictEqual(run(undefined), [10000, 10000, 10000])
        assert.strict.deepStrictEqual(run(0), [10000, 10000, 10000])
        assert.strict.deepStrictEqual(run('abc'), [10000, 10000, 10000])
        assert.strict.deepStrictEqual(run(Infinity), [10000, 10000, 10000]) //spawnSync之timeout非有限值即拋錯, 下殺會被靜默吞掉
        assert.strict.deepStrictEqual(run('3000'), [3000, 3000, 3000]) //字串型數字
    })

})


describe('killPortListeners [真實] 本機真實子指令與真實子程序', function() {

    //固定埠(>=8000, 不隨機); 須空閒, 否則該條失敗並註明
    let PORT = 19051

    it('[RP03] 無人監聽之埠: 回{pids:[],killed:[]}(真實netstat/PowerShell確認, 非查詢失敗)', function() {
        this.timeout(60000)
        //規格③: 無人與失敗分開; 真實查詢在 Windows 本機約 1~2 秒
        let r = killPortListeners(PORT, { timeout: 20000 })
        if (r.pids === null && process.platform !== 'win32') {
            return this.skip() //非Windows且無lsof
        }
        assert.strict.deepStrictEqual(r, { pids: [], killed: [] })
    })

    it('[RP04] 真實子程序監聽(127.0.0.1): killPortListeners殺掉它, 子程序結束, 埠釋放', async function() {
        this.timeout(90000)
        //規格: 殺監聽者之行程樹並可回驗; 子程序為自建(測試擁有), 不碰他人行程
        let code = `require('net').createServer().on('error', (e) => { console.log('ERR ' + e.code); process.exit(3) }).listen(${PORT}, '127.0.0.1', () => console.log('READY'))`
        let child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
        let exited = new Promise((resolve) => child.once('exit', (c, s) => resolve({ c, s })))
        //攔截(透傳)spawnSync, 記錄預設執行函數下殺時之選項
        let seen = []
        let origSpawnSync = cp.spawnSync
        cp.spawnSync = (...a) => {
            seen.push(a)
            return origSpawnSync(...a)
        }
        syncBuiltinESMExports()
        try {
            let line = await new Promise((resolve, reject) => {
                child.stdout.once('data', (b) => resolve(String(b).trim()))
                child.once('error', reject)
                child.once('exit', () => resolve('EXIT'))
            })
            assert.strict.deepStrictEqual(line, 'READY', `子程序未能監聽${PORT}(須空閒)`)
            let r = killPortListeners(PORT, { timeout: 20000 })
            if (r.pids === null && process.platform !== 'win32') {
                return this.skip()
            }
            assert.strict.deepStrictEqual(r, { pids: [String(child.pid)], killed: [String(child.pid)] })
            //預設執行函數下殺之選項: 不經shell、隱藏視窗、stdin不開、帶逾時(在exit/signal處理器內卡住會使行程無法結束)
            let killCall = seen.find((a) => a[0] === (process.platform === 'win32' ? 'taskkill' : 'sh'))
            assert.strict.ok(killCall, '預設執行函數須以spawnSync下殺')
            let o = killCall[2]
            assert.strict.deepStrictEqual([o.windowsHide, !!o.shell, o.stdio[0], o.timeout], [true, false, 'ignore', 20000])
            await exited //子程序確實結束(事件同步, 不等固定時間)
            assert.strict.deepStrictEqual(isChildAlive(child), false)
            //回驗: 埠已釋放(已確認無人)
            assert.strict.deepStrictEqual(listenerPids(PORT, { useBoth: true, timeout: 20000 }), [])
        }
        finally {
            cp.spawnSync = origSpawnSync
            syncBuiltinESMExports()
            if (isChildAlive(child)) {
                killOwnTree(child)
                await exited
            }
        }
    })

})
