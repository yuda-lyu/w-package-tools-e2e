import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawn, spawnSync } from 'child_process'
import reserveE2ePorts from '../src/reserveE2ePorts.mjs'
import createServiceManager from '../src/createServiceManager.mjs'
import pidExists from '../src/pidExists.mjs'
import { fpSrv, spawnOccupant, assertOccupantIntact, stopChild } from './tools/portOccupant.mjs'


//就緒核對、restart 查不到監聽者、reselect 用盡之實機測試: 真實監聽行程與真實占用者, 占用者 PID 不變、仍回應。
//規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E4、E5; 帳本 sgud/rule/rulebook_port.md R-15～R-20。
//固定埠(不隨機; 避開 19620、19630、19640 與其位移, 19711～19716、19800、19801): 19650 起, 每案自行遞增。


let fdRoot = path.resolve('test/_tmp/apiServiceOwner')
let regDir = path.join(fdRoot, 'reg')
let HOSTS = ['127.0.0.1', '0.0.0.0', '::', '::1']
let node = process.execPath
let portNext = 19650
let spawned = []
let handles = []
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


function nextPort(n = 2) {
    let p = portNext
    portNext += n
    return p
}


function startFixture(role, port) {
    let child = spawn(node, [fpSrv, role, String(port)], { stdio: 'ignore', windowsHide: true })
    spawned.push(child)
    return child
}


function reserve(port, opt = {}) {
    let h = reserveE2ePorts([port], { applyEnv: false, regDir, log: () => {}, ...opt })
    handles.push(h)
    return h
}


async function waitGone(pid, label) {
    let t0 = Date.now()
    while (pidExists(pid)) {
        if (Date.now() - t0 > 15000) {
            throw new Error(`等待結束逾時: ${label} PID ${pid}`)
        }
        await sleep(50)
    }
}


//自建之服務已收掉: 程序不在
async function assertOwnGone(child) {
    await waitGone(child.pid, '自建之服務')
    assert.strict.equal(pidExists(child.pid), false)
}


async function answerOf(url) {
    return (await fetch(url)).json()
}


describe('就緒核對實機', function() {

    this.timeout(120000)

    before(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        fs.mkdirSync(regDir, { recursive: true })
    })

    afterEach(function() {
        handles.splice(0).forEach((h) => h.release())
        spawned.splice(0).forEach(stopChild)
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    })

    //派工第 3 項: 偵測與綁定之間被搶走(四種位址)
    for (let host of HOSTS) {
        it(`[SA1] 保留後、spawn 前被占走(占用者綁 ${host}): 拋錯寫明埠與占用者, 占用者 PID 不變且仍回應, 自建已收`, async function() {
            let port = nextPort()
            let res = reserve(port)
            let occ = null
            let own = null
            let sm = createServiceManager({
                reservation: res,
                ownerRetryMs: 100,
                log: () => {},
                services: [{
                    name: 'svc',
                    port,
                    readyTimeoutMs: 20000,
                    beforeSpawn: async () => {
                        occ = await spawnOccupant(port, host, spawned)
                    },
                    spawn: ({ port: p }) => {
                        own = startFixture('back', p)
                        return own
                    },
                }],
            })
            await assert.rejects(sm.startServersOnce(), (err) => {
                assert.strict.equal(err.code, 'E2E_PORT_NOT_OWN', err.message)
                assert.ok(err.message.includes(`埠 ${port}`), err.message)
                assert.ok(err.message.includes(`PID ${occ.child.pid}`), err.message)
                assert.ok(!err.message.includes(`占用者 PID ${own.pid}`), `訊息不得把自建說成占用者: ${err.message}`)
                return true
            })
            await assertOccupantIntact(occ)
            await assertOwnGone(own)
            assert.strict.equal(sm.state('svc').owned, false)
            sm.cleanup()
            await assertOccupantIntact(occ)
        })
    }

    //派工第 3 項: vue-cli 之 --port 只是起點(真實 portfinder 行為之夾具; 真實 vue-cli 見報告)
    it('[SA2] 服務靜默改埠(portfinder): 拋錯, 占用者仍回應, 改埠後之自建已收、埠已釋放', async function() {
        let port = nextPort(3)
        let res = reserve(port)
        let occ = null
        let own = null
        let sm = createServiceManager({
            reservation: res,
            ownerRetryMs: 100,
            log: () => {},
            services: [{
                name: 'dev',
                port,
                readyTimeoutMs: 20000,
                beforeSpawn: async () => {
                    occ = await spawnOccupant(port, '127.0.0.1', spawned)
                },
                spawn: ({ port: p }) => {
                    own = startFixture('portfinder', p)
                    return own
                },
            }],
        })
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN' && err.message.includes(`PID ${occ.child.pid}`))
        await assertOccupantIntact(occ)
        await assertOwnGone(own)
        await assert.rejects(fetch(`http://127.0.0.1:${port + 1}/`), '改埠後之自建已收')
    })

    it('[SA3] 占用者非 HTTP 使探測一直不通, 服務靜默改埠: 就緒逾時之訊息寫明占用者', async function() {
        let port = nextPort(3)
        let res = reserve(port)
        let tcp = null
        let sm = createServiceManager({
            reservation: res,
            log: () => {},
            services: [{
                name: 'dev',
                port,
                readyTimeoutMs: 2500,
                beforeSpawn: async () => {
                    tcp = startFixture('tcp', port)
                    await sleep(500)
                },
                spawn: ({ port: p }) => startFixture('portfinder', p),
            }],
        })
        await assert.rejects(sm.startServersOnce(), (err) => err.message.includes('server not ready') && err.message.includes(`PID ${tcp.pid}`))
        assert.strict.equal(pidExists(tcp.pid), true)
        sm.cleanup()
    })

    //正常服務不得被擋(身分核對之假陽性)
    it('[SA4] 服務直接監聽: 放行, state 為自建; restart 後新實例亦放行', async function() {
        let port = nextPort()
        let res = reserve(port)
        let own = []
        let sm = createServiceManager({
            reservation: res,
            log: () => {},
            services: [{
                name: 'svc',
                port,
                readyTimeoutMs: 30000,
                spawn: ({ port: p }) => {
                    let c = startFixture('back', p)
                    own.push(c)
                    return c
                },
            }],
        })
        await sm.startServersOnce()
        assert.strict.equal(sm.state('svc').pid, own[0].pid)
        assert.strict.equal((await answerOf(`http://127.0.0.1:${port}/`)).pid, own[0].pid)
        await sm.restart('svc')
        assert.strict.equal(sm.state('svc').pid, own[1].pid)
        assert.strict.equal((await answerOf(`http://127.0.0.1:${port}/`)).pid, own[1].pid)
        assert.strict.equal(pidExists(own[0].pid), false)
        sm.cleanup()
    })

    it('[SA5] shell:true(同 npm run serve): 監聽者為孫行程, 放行', async function() {
        let port = nextPort()
        let res = reserve(port)
        let sm = createServiceManager({
            reservation: res,
            log: () => {},
            services: [{
                name: 'svc',
                port,
                readyTimeoutMs: 30000,
                spawn: ({ port: p }) => {
                    let c = spawn(`node "${fpSrv}" back ${p}`, { stdio: 'ignore', windowsHide: true, shell: true })
                    spawned.push(c)
                    return c
                },
            }],
        })
        await sm.startServersOnce()
        let j = await answerOf(`http://127.0.0.1:${port}/`)
        assert.strict.notEqual(j.pid, sm.state('svc').pid, '監聽者是子孫, 不是 shell 本身')
        sm.cleanup()
    })

    it('[SA6] launcher 仍在、由子行程監聽: 放行', async function() {
        let port = nextPort()
        let res = reserve(port)
        let sm = createServiceManager({
            reservation: res,
            log: () => {},
            services: [{ name: 'svc', port, readyTimeoutMs: 30000, spawn: ({ port: p }) => startFixture('launcher', p) }],
        })
        await sm.startServersOnce()
        let j = await answerOf(`http://127.0.0.1:${port}/`)
        assert.strict.notEqual(j.pid, sm.state('svc').pid)
        sm.cleanup()
    })

    it('[SA7] 同一行程監聽兩個位址: 放行', async function() {
        let port = nextPort()
        let res = reserve(port)
        let sm = createServiceManager({
            reservation: res,
            log: () => {},
            services: [{ name: 'svc', port, readyTimeoutMs: 30000, spawn: ({ port: p }) => startFixture('dual', p) }],
        })
        await sm.startServersOnce()
        sm.cleanup()
    })

    //已知限制: 寫入 README
    it('[SA8] launcher 先結束、服務由 detached 行程接手: 無法判定, 拋 E2E_PORT_NOT_OWN(已知限制), 不下殺該服務', async function() {
        let port = nextPort()
        let res = reserve(port)
        let sm = createServiceManager({
            reservation: res,
            ownerRetryMs: 100,
            log: () => {},
            services: [{ name: 'svc', port, readyTimeoutMs: 30000, spawn: ({ port: p }) => startFixture('launcher-exit', p) }],
        })
        let pid = 0
        try {
            await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_NOT_OWN' && err.message.includes('已結束'))
            pid = (await answerOf(`http://127.0.0.1:${port}/`)).pid
            assert.strict.equal(pidExists(pid), true, '工具不下殺無法確認身分者')
        }
        finally {
            if (pid) {
                spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
            }
        }
    })

    //pinned: 手動鎖埠沿用既有服務之語意照舊
    it('[SA9] pinned 且埠已有服務: 照舊沿用(不 spawn、不核對、不下殺)', async function() {
        let port = nextPort()
        let env = { E2E_PORT_OFFSET: '0' }
        let res = reserve(port, { env, applyEnv: true })
        assert.strict.equal(res.source, 'pinned')
        let occ = await spawnOccupant(port, '127.0.0.1', spawned)
        let n = 0
        let sm = createServiceManager({
            env,
            reservation: res,
            log: () => {},
            services: [{
                name: 'svc',
                port,
                spawn: () => {
                    n++
                    return null
                },
            }],
        })
        await sm.startServersOnce()
        assert.strict.equal(n, 0)
        assert.strict.equal(sm.state('svc').owned, false)
        sm.cleanup()
        await assertOccupantIntact(occ)
    })

    //他人片刻即離開(依事件同步: 第一輪核對完才讓占用者結束)
    it('[SA10] 第一輪核對時有他人並存, 之後他人離開: 重試後放行, 不誤判', async function() {
        let port = nextPort()
        let res = reserve(port)
        let occ = null
        let tableRuns = 0
        let exec = (prog, args, o) => {
            let r = spawnSync(prog, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: o.timeout, maxBuffer: o.maxBuffer, windowsHide: true })
            if (o.src === 'table' && ++tableRuns === 1) {
                stopChild(occ.child)
                for (let i = 0; i < 200 && pidExists(occ.child.pid); i++) {
                    spawnSync('cmd', ['/c', 'ver'], { stdio: 'ignore', windowsHide: true })
                }
                assert.strict.equal(pidExists(occ.child.pid), false, '占用者應已結束')
            }
            return r
        }
        let sm = createServiceManager({
            reservation: res,
            exec,
            ownerRetryMs: 100,
            log: () => {},
            services: [{
                name: 'svc',
                port,
                readyTimeoutMs: 30000,
                beforeSpawn: async () => {
                    occ = await spawnOccupant(port, '::1', spawned)
                },
                spawn: ({ port: p }) => startFixture('back', p),
            }],
        })
        await sm.startServersOnce()
        assert.ok(tableRuns >= 2, `應重試(${tableRuns})`)
        sm.cleanup()
    })

    //查詢失敗: 真實監聽者, 注入查詢失敗
    it('[SA11] 就緒核對查詢一直失敗(真實服務): 拋 E2E_PORT_OWNER_UNKNOWN, 收自建, 不當成自己人', async function() {
        let port = nextPort()
        let res = reserve(port)
        let own = null
        let sm = createServiceManager({
            reservation: res,
            exec: () => ({ status: 1, stdout: '', error: new Error('查詢失敗(注入)') }),
            ownerRetryMs: 50,
            log: () => {},
            services: [{
                name: 'svc',
                port,
                readyTimeoutMs: 30000,
                spawn: ({ port: p }) => {
                    own = startFixture('back', p)
                    return own
                },
            }],
        })
        await assert.rejects(sm.startServersOnce(), (err) => err.code === 'E2E_PORT_OWNER_UNKNOWN')
        await assertOwnGone(own)
    })

    it('[SA12] 就緒核對查詢前兩次失敗、第三次恢復(真實服務): 放行', async function() {
        let port = nextPort()
        let res = reserve(port)
        let fails = 0
        let exec = (prog, args, o) => {
            //wsemi 之查詢: 一輪失敗至少含 netstat 與 powershell 各一; 前兩輪皆失敗
            if ((o.src === 'netstat' || o.src === 'powershell') && fails < 4) {
                fails++
                return { status: 1, stdout: '', error: new Error('查詢失敗(注入)') }
            }
            return spawnSync(prog, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: o.timeout, maxBuffer: o.maxBuffer, windowsHide: true })
        }
        let sm = createServiceManager({
            reservation: res,
            exec,
            ownerRetryMs: 50,
            log: () => {},
            services: [{ name: 'svc', port, readyTimeoutMs: 30000, spawn: ({ port: p }) => startFixture('back', p) }],
        })
        await sm.startServersOnce()
        assert.strict.equal(fails, 4)
        sm.cleanup()
    })

})


describe('restart 實機', function() {

    this.timeout(120000)

    before(function() {
        fs.mkdirSync(regDir, { recursive: true })
    })

    afterEach(function() {
        handles.splice(0).forEach((h) => h.release())
        spawned.splice(0).forEach(stopChild)
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    })

    function mkPinned(port, exec) {
        let env = { E2E_PORT_OFFSET: '0' }
        let res = reserve(port, { env, applyEnv: true, exec })
        let own = []
        let sm = createServiceManager({
            env,
            reservation: res,
            killForeignOnRestart: true,
            portReleaseTimeoutMs: 1000,
            ownerRetryMs: 50,
            exec,
            log: () => {},
            services: [{
                name: 'svc',
                port,
                readyTimeoutMs: 20000,
                spawn: ({ port: p }) => {
                    let c = startFixture('back', p)
                    own.push(c)
                    return c
                },
            }],
        })
        return { sm, own, res }
    }

    //派工第 4 項: 查不到監聽者時不得續行(四種位址)
    for (let host of HOSTS) {
        it(`[SA20] 查不到監聽者(占用者綁 ${host}, 注入查詢失敗): 拋錯寫明, 占用者 PID 不變且仍回應`, async function() {
            let port = nextPort()
            let fail = false
            let exec = (prog, args, o) => {
                if (fail) {
                    return { status: 1, stdout: '', error: new Error('查詢失敗(注入)') }
                }
                return spawnSync(prog, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: o.timeout, maxBuffer: o.maxBuffer, windowsHide: true })
            }
            let { sm, own } = mkPinned(port, exec)
            let occ = await spawnOccupant(port, host, spawned)
            fail = true
            await assert.rejects(sm.restart('svc'), (err) => {
                //占用者綁 ::1 時 127.0.0.1 之探測不通: 不走 killForeign, spawn 後由就緒核對把關(同樣查不到, 同樣不放行)
                if (host === '::1') {
                    assert.strict.equal(err.code, 'E2E_PORT_OWNER_UNKNOWN', err.message)
                }
                else {
                    assert.ok(err.message.includes(`查不到 port ${port} 之監聽者`) && err.message.includes('不續行'), err.message)
                }
                return true
            })
            fail = false
            await assertOccupantIntact(occ)
            if (host === '::1') {
                await assertOwnGone(own[0])
            }
            else {
                assert.strict.equal(own.length, 0, '查不到時不得 spawn')
            }
        })
    }

    //查得到: 他人占用一律不殺
    for (let host of HOSTS) {
        it(`[SA21] 查得到且為他人(占用者綁 ${host}): 拋錯寫明占用者, 不下殺`, async function() {
            let port = nextPort()
            let { sm, own } = mkPinned(port, undefined)
            let occ = await spawnOccupant(port, host, spawned)
            await assert.rejects(sm.restart('svc'), (err) => {
                assert.ok(err.message.includes(`PID ${occ.child.pid}`), err.message)
                if (host === '::1') {
                    assert.strict.equal(err.code, 'E2E_PORT_NOT_OWN', err.message)
                }
                else {
                    assert.ok(err.message.includes('被非本實例之行程占用'), err.message)
                }
                return true
            })
            await assertOccupantIntact(occ)
            if (host === '::1') {
                await assertOwnGone(own[0])
            }
            else {
                assert.strict.equal(own.length, 0, '他人占用時不得 spawn')
            }
        })
    }

    it('[SA22] 真實服務之 restart(自建): 舊實例被換掉, 新實例通過核對', async function() {
        let port = nextPort()
        let { sm, own } = mkPinned(port, undefined)
        await sm.startServersOnce()
        let pid0 = sm.state('svc').pid
        assert.strict.equal(pid0, own[0].pid)
        await sm.restart('svc')
        assert.strict.notEqual(sm.state('svc').pid, pid0)
        assert.strict.equal(pidExists(pid0), false)
        sm.cleanup()
    })

})


describe('reselect 用盡實機', function() {

    this.timeout(60000)

    before(function() {
        fs.mkdirSync(regDir, { recursive: true })
    })

    afterEach(function() {
        handles.splice(0).forEach((h) => h.release())
        spawned.splice(0).forEach(stopChild)
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    })

    //派工第 1 項(四種位址)
    for (let host of HOSTS) {
        it(`[SA30] 用盡(占用者綁 ${host}): 訊息含觸發之埠與占用者, 占用者 PID 不變且仍回應`, async function() {
            let port = nextPort()
            let res = reserve(port, { maxTries: 1 })
            let occ = await spawnOccupant(port, host, spawned)
            assert.throws(() => res.reselect('EADDRINUSE'), (err) => {
                assert.strict.equal(err.code, 'E2E_PORT_EXHAUSTED')
                assert.ok(err.message.includes(`埠 ${port}: PID ${occ.child.pid}`), err.message)
                assert.ok(err.message.includes('觸發本次重選(EADDRINUSE)'), err.message)
                return true
            })
            await assertOccupantIntact(occ)
        })
    }

    //派工第 2 項查實: 綁定失敗而查無監聽者之實際成因之一(僅綁定未 listen 之 socket, 真實 PowerShell Socket.Bind)
    it('[SA31] 僅綁定未監聽之 socket 占著基準埠: 實際綁定偵測得到而換埠, 訊息寫明查無監聽者與可能成因', async function() {
        let port = nextPort()
        let ps = `$s=New-Object Net.Sockets.Socket([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Stream,[Net.Sockets.ProtocolType]::Tcp);$s.Bind((New-Object Net.IPEndPoint([Net.IPAddress]::Parse('127.0.0.1'),${port})));[Console]::Out.WriteLine('ready');[Console]::In.ReadToEnd()|Out-Null;$s.Close()`
        let holder = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
        spawned.push(holder)
        await new Promise((resolve, reject) => {
            holder.stdout.once('data', resolve)
            holder.once('exit', () => reject(new Error('僅綁定之夾具結束')))
        })
        let logs = []
        let res = reserve(port, { log: (s) => logs.push(String(s)) })
        assert.strict.equal(res.offset, 100, logs.join('\n'))
        let txt = logs.join('\n')
        assert.ok(txt.includes(`埠 ${port}`) && txt.includes('EADDRINUSE') && txt.includes('查無監聽者') && txt.includes('僅綁定未監聽'), txt)
        holder.stdin.end()
    })

})
