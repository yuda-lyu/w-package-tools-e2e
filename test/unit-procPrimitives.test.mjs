import assert from 'assert'
import { EventEmitter } from 'events'
import parseListenerPids from '../src/parseListenerPids.mjs'
import listenerPids from '../src/listenerPids.mjs'
import isChildAlive from '../src/isChildAlive.mjs'
import waitChildExit from '../src/waitChildExit.mjs'
import pidExists from '../src/pidExists.mjs'
import sleepSync from '../src/sleepSync.mjs'
import killOwnTree from '../src/killOwnTree.mjs'
import killPortListeners from '../src/killPortListeners.mjs'


//行程原語之單元測試(不需server/browser, 以注入之假依賴執行)
//parseListenerPids/listenerPids/isChildAlive/waitChildExit/pidExists/killOwnTree之案例移植自w-web-task test/unit-harnessProc.test.mjs


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


describe('parseListenerPids', function() {

    it('IPv4與IPv6之監聽列皆取到, 同一PID去重', function() {
        assert.strict.deepStrictEqual(parseListenerPids(NETSTAT, 11108), ['15816'])
    })

    it('外部位址為:port之連線列、其他port、UDP列皆不算', function() {
        let pids = parseListenerPids(NETSTAT, 11108)
        assert.strict.ok(!pids.includes('3333'))
        assert.strict.ok(!pids.includes('2222'))
        assert.strict.ok(!pids.includes('5555'))
    })

    it('IPv6迴路位址、zone id、在地化狀態字(以外部位址判定監聽)皆取得到', function() {
        assert.strict.deepStrictEqual(parseListenerPids(NETSTAT, 8091), ['4444'])
        assert.strict.deepStrictEqual(parseListenerPids(NETSTAT, 9100), ['6666'])
        assert.strict.deepStrictEqual(parseListenerPids(NETSTAT, 9200), ['7777'])
    })

    it('無此port、空字串、undefined回[]', function() {
        assert.strict.deepStrictEqual(parseListenerPids(NETSTAT, 9999), [])
        assert.strict.deepStrictEqual(parseListenerPids('', 11108), [])
        assert.strict.deepStrictEqual(parseListenerPids(undefined, 11108), [])
    })

})


describe('listenerPids', function() {

    it('win32: 以netstat -ano(不加-p TCP)取得並解析, 且帶逾時', function() {
        let { exec, calls, opts } = makeExec(() => NETSTAT)
        assert.strict.deepStrictEqual(listenerPids(11108, { exec, platform: 'win32' }), ['15816'])
        assert.strict.deepStrictEqual(calls, ['netstat -ano'])
        assert.strict.ok(opts[0].timeout > 0)
    })

    it('win32: netstat失敗回null(非[])', function() {
        let { exec } = makeExec(() => {
            throw new Error('ENOENT')
        })
        assert.strict.deepStrictEqual(listenerPids(11108, { exec, platform: 'win32' }), null)
    })

    it('posix: lsof輸出之PID去重; exit 1(查無)回[], 其他失敗回null', function() {
        let { exec, calls } = makeExec(() => '123\n456\n123\n')
        assert.strict.deepStrictEqual(listenerPids(11108, { exec, platform: 'linux' }), ['123', '456'])
        assert.strict.deepStrictEqual(calls[0], 'lsof -nP -iTCP:11108 -sTCP:LISTEN -t')
        let e1 = Object.assign(new Error('exit 1'), { status: 1 })
        let e127 = Object.assign(new Error('not found'), { status: 127 })
        assert.strict.deepStrictEqual(listenerPids(11108, {
            exec: () => {
                throw e1
            },
            platform: 'linux',
        }), [])
        assert.strict.deepStrictEqual(listenerPids(11108, {
            exec: () => {
                throw e127
            },
            platform: 'linux',
        }), null)
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

    it('win32: 殺全部監聽者(IPv4/IPv6去重後各一次), 不殺連線列之PID', function() {
        let { exec, calls } = makeExec((cmd) => cmd === 'netstat -ano' ? NETSTAT : '')
        let r = killPortListeners(11108, { exec, platform: 'win32', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: ['15816'], killed: ['15816'] })
        assert.strict.deepStrictEqual(calls, ['netstat -ano', 'taskkill /F /T /PID 15816'])
    })

    it('exclude內之PID不殺(預設排除本行程)', function() {
        let { exec, calls } = makeExec((cmd) => cmd === 'netstat -ano' ? NETSTAT : '')
        let r = killPortListeners(11108, { exec, platform: 'win32', exclude: [15816] })
        assert.strict.deepStrictEqual(r, { pids: ['15816'], killed: [] })
        assert.strict.deepStrictEqual(calls, ['netstat -ano'])
    })

    it('無監聽者: 不下殺', function() {
        let { exec, calls } = makeExec(() => NETSTAT)
        assert.strict.deepStrictEqual(killPortListeners(9999, { exec, platform: 'win32', exclude: [] }), { pids: [], killed: [] })
        assert.strict.deepStrictEqual(calls, ['netstat -ano'])
    })

    it('查詢工具不可用: 回pids:null且不下殺', function() {
        let { exec, calls } = makeExec(() => {
            throw new Error('ENOENT')
        })
        assert.strict.deepStrictEqual(killPortListeners(11108, { exec, platform: 'win32', exclude: [] }), { pids: null, killed: [] })
        assert.strict.deepStrictEqual(calls.length, 1)
    })

    it('posix: 以kill -9殺lsof查得之PID', function() {
        let { exec, calls } = makeExec((cmd) => cmd.startsWith('lsof') ? '321\n' : '')
        let r = killPortListeners(11007, { exec, platform: 'linux', exclude: [] })
        assert.strict.deepStrictEqual(r, { pids: ['321'], killed: ['321'] })
        assert.strict.deepStrictEqual(calls, ['lsof -nP -iTCP:11007 -sTCP:LISTEN -t', 'kill -9 321'])
    })

    it('下殺失敗(已結束或無權限)不拋錯, 不列入killed', function() {
        let { exec } = makeExec((cmd) => {
            if (cmd === 'netstat -ano') return NETSTAT
            throw new Error('not found')
        })
        assert.strict.deepStrictEqual(killPortListeners(11108, { exec, platform: 'win32', exclude: [] }), { pids: ['15816'], killed: [] })
    })

})
