import assert from 'assert'
import net from 'net'
import { spawn } from 'child_process'
import resolveE2ePort from '../src/resolveE2ePort.mjs'
import createServiceManager from '../src/createServiceManager.mjs'


//埠位移(Gitea issue #19 第3項)之單元測試: resolveE2ePort 之解析、createServiceManager 之探測／spawn／url／殺監聽者皆用實際埠、預設不變;
//另以真實子行程服務驗證 E2E_PORT_OFFSET 下 baseUrl 與服務埠一致(基準埠 18930 固定、不隨機)


//假環境: up[port] 代表該 port 是否有回應; spawn 後 1 次探測即就緒
function fakeEnv() {
    let env = { up: {}, spawns: [], probes: [], listenerKills: [], hooks: [] }
    env.probe = async (svc) => {
        env.probes.push([svc.port, svc.url])
        return !!env.up[svc.port]
    }
    env.spawnOf = (name) => (o) => {
        env.spawns.push({ name, port: o.port, args: o.args })
        env.up[o.port] = true
        return { pid: 1000 + env.spawns.length, name, exitCode: null, signalCode: null }
    }
    env.killTree = () => {}
    env.killListeners = (port) => {
        env.listenerKills.push(port)
        env.up[port] = false
        return { pids: ['9'], killed: ['9'] }
    }
    return env
}

function mkSm(fe, env, over = {}) {
    return createServiceManager({
        services: [
            { name: 'backend', port: 11007, readyTimeoutMs: 80, spawn: fe.spawnOf('backend'), beforeSpawn: async (o) => fe.hooks.push([o.phase, o.port]) },
            { name: 'frontend', port: 8080, readyTimeoutMs: 80, spawn: fe.spawnOf('frontend') },
        ],
        env,
        probe: fe.probe,
        pollMs: 1,
        portReleaseTimeoutMs: 20,
        portReleasePollMs: 1,
        killTree: fe.killTree,
        killListeners: fe.killListeners,
        log: () => {},
        ...over,
    })
}

//port 是否可連線
function canConnect(port) {
    return new Promise((resolve) => {
        let s = net.connect({ host: '127.0.0.1', port })
        s.once('connect', () => {
            s.destroy()
            resolve(true)
        })
        s.once('error', () => resolve(false))
    })
}


describe('埠位移(E2E_PORT_OFFSET)', function() {

    it('[P01] resolveE2ePort: 未設／空字串／0 原樣回傳(不轉型); 非負整數加到基準埠; 格式錯誤、基準埠不合法、超過 65535 即拋錯', function() {
        for (let env of [{}, { E2E_PORT_OFFSET: '' }, { E2E_PORT_OFFSET: '  ' }, { E2E_PORT_OFFSET: '0' }]) {
            assert.strict.equal(resolveE2ePort(8080, { env }), 8080)
            assert.strict.equal(resolveE2ePort('8080', { env }), '8080')
        }
        assert.strict.equal(resolveE2ePort(8080, { env: { E2E_PORT_OFFSET: '100' } }), 8180)
        assert.strict.equal(resolveE2ePort('11007', { env: { E2E_PORT_OFFSET: ' 100 ' } }), 11107)
        assert.strict.equal(resolveE2ePort(8080, { env: { PO: '5' }, offsetEnv: 'PO' }), 8085)
        for (let bad of ['-1', '1.5', 'abc', '1e2', '+3']) {
            assert.throws(() => resolveE2ePort(8080, { env: { E2E_PORT_OFFSET: bad } }), /E2E_PORT_OFFSET 須為非負整數/)
        }
        assert.throws(() => resolveE2ePort(0, { env: { E2E_PORT_OFFSET: '1' } }), /基準埠須為/)
        assert.throws(() => resolveE2ePort('x', { env: { E2E_PORT_OFFSET: '1' } }), /基準埠須為/)
        assert.throws(() => resolveE2ePort(65500, { env: { E2E_PORT_OFFSET: '100' } }), /超過 65535/)
        //預設讀 process.env
        let saved = process.env.E2E_PORT_OFFSET
        process.env.E2E_PORT_OFFSET = '3'
        try {
            assert.strict.equal(resolveE2ePort(8000), 8003)
        }
        finally {
            if (saved === undefined) {
                delete process.env.E2E_PORT_OFFSET
            }
            else {
                process.env.E2E_PORT_OFFSET = saved
            }
        }
    })

    it('[P02] createServiceManager 預設不變(未設位移): 探測之 port／url 為基準埠, spawn 與 beforeSpawn 收到基準埠, portOf 回基準埠', async function() {
        let fe = fakeEnv()
        let sm = mkSm(fe, {})
        await sm.startServersOnce()
        assert.strict.deepStrictEqual(fe.probes.slice(0, 1), [[11007, 'http://127.0.0.1:11007/']])
        assert.strict.deepStrictEqual(fe.spawns.map((s) => [s.name, s.port]), [['backend', 11007], ['frontend', 8080]])
        assert.strict.deepStrictEqual(fe.hooks, [['start', 11007]])
        assert.strict.deepStrictEqual([sm.portOf('backend'), sm.portOf('frontend')], [11007, 8080])
    })

    it('[P03] E2E_PORT_OFFSET=100: 探測、spawn、beforeSpawn、就緒逾時訊息、restart 之殺監聽者皆用實際埠; portOf 回實際埠', async function() {
        let fe = fakeEnv()
        let env = { E2E_PORT_OFFSET: '100' }
        let sm = mkSm(fe, env, { killForeignOnRestart: true })
        await sm.startServersOnce()
        assert.strict.deepStrictEqual(fe.probes.slice(0, 1), [[11107, 'http://127.0.0.1:11107/']])
        assert.strict.deepStrictEqual(fe.spawns.map((s) => [s.name, s.port]), [['backend', 11107], ['frontend', 8180]])
        assert.strict.deepStrictEqual([sm.portOf('backend'), sm.portOf('frontend')], [11107, 8180])
        //無自建而 port 被佔: 殺實際埠之監聽者
        let fe2 = fakeEnv()
        fe2.up[11107] = true
        let sm2 = mkSm(fe2, env, { killForeignOnRestart: true })
        await sm2.restart('backend', { args: ['s.json'] })
        assert.strict.deepStrictEqual([fe2.listenerKills, fe2.spawns.map((s) => s.port), fe2.hooks], [[11107], [11107], [['restart', 11107]]])
        //就緒逾時訊息帶實際埠
        let sm3 = createServiceManager({
            services: [{ name: 'b', port: 11007, readyTimeoutMs: 20, spawn: () => ({ pid: 1 }) }],
            env,
            probe: async () => false,
            pollMs: 1,
            log: () => {},
        })
        await assert.rejects(sm3.startServersOnce(), /server not ready on port 11107 after 0\.02s/)
        //未位移時原訊息
        let sm4 = createServiceManager({ services: [{ name: 'b', port: 11007, readyTimeoutMs: 20, spawn: () => ({ pid: 1 }) }], env: {}, probe: async () => false, pollMs: 1, log: () => {} })
        await assert.rejects(sm4.startServersOnce(), /server not ready on port 11007 after 0\.02s/)
    })

    it('[P04] url: 字串者其埠等於基準埠才位移(不等即拋錯, 免探測到他實例), 未位移時原樣; 函數者以實際埠呼叫; 預設 url 依 host', async function() {
        let probeUrl = async (env, svc, over = {}) => {
            let seen = []
            let sm = createServiceManager({
                services: [{ name: 'b', port: 11007, spawn: () => ({ pid: 1 }), ...svc }],
                env,
                probe: async (s) => {
                    seen.push(s.url)
                    return true
                },
                log: () => {},
                ...over
            })
            await sm.startServersOnce()
            return seen[0]
        }
        let off = { E2E_PORT_OFFSET: '100' }
        assert.strict.equal(await probeUrl(off, { url: 'http://127.0.0.1:11007/health' }), 'http://127.0.0.1:11107/health')
        assert.strict.equal(await probeUrl({}, { url: 'http://127.0.0.1:11007/health' }), 'http://127.0.0.1:11007/health')
        assert.strict.equal(await probeUrl(off, { url: (port) => `http://127.0.0.1:${port}/api/ping` }), 'http://127.0.0.1:11107/api/ping')
        assert.strict.equal(await probeUrl({}, { url: (port) => `http://127.0.0.1:${port}/api/ping` }), 'http://127.0.0.1:11007/api/ping')
        assert.strict.equal(await probeUrl(off, {}, { host: 'localhost' }), 'http://localhost:11107/')
        assert.throws(() => createServiceManager({ services: [{ name: 'b', port: 11007, url: 'http://127.0.0.1:9999/', spawn: () => {} }], env: off }), /url 埠\(9999\)不等於 port 11007/)
        //協定預設埠(外審 F20): http 80、https 443 明寫或省略皆視為該埠
        assert.strict.equal(await probeUrl(off, { port: 80, url: 'http://127.0.0.1:80/health' }), 'http://127.0.0.1:180/health')
        assert.strict.equal(await probeUrl(off, { port: 80, url: 'http://127.0.0.1/health' }), 'http://127.0.0.1:180/health')
        assert.strict.equal(await probeUrl(off, { port: 443, url: 'https://127.0.0.1/x' }), 'https://127.0.0.1:543/x')
        assert.strict.equal(await probeUrl(off, { port: 443, url: 'https://127.0.0.1:443/x' }), 'https://127.0.0.1:543/x')
        //非 http(s) 而省略埠者無從推定, 位移時拋錯
        assert.throws(() => createServiceManager({ services: [{ name: 'b', port: 11007, url: 'ws://127.0.0.1/', spawn: () => {} }], env: off }), /url 埠\(協定預設\)不等於 port 11007/)
        assert.throws(() => createServiceManager({ services: [{ name: 'b', port: 443, url: 'http://127.0.0.1/', spawn: () => {} }], env: off }), /url 埠\(協定預設\)不等於 port 443/)
        assert.throws(() => createServiceManager({ services: [{ name: 'b', port: 11007, spawn: () => {} }], env: { E2E_PORT_OFFSET: 'x' } }), /E2E_PORT_OFFSET 須為非負整數/)
        //缺 port 之檢查訊息不因位移而改變
        assert.throws(() => createServiceManager({ services: [{ name: 'b', spawn: () => {} }], env: off }), /每個服務須有 name、port、spawn/)
    })

    it('[P06] 預設不變之物件形狀(外審 F8): spawn／beforeSpawn 參數物件與管理器回傳物件之可列舉鍵與鍵序同 1.0.10, port／portOf 為不可列舉屬性仍可取用', async function() {
        let fe = fakeEnv()
        let keys = []
        let sm = createServiceManager({
            services: [{
                name: 'b',
                port: 11007,
                readyTimeoutMs: 80,
                spawn: (o) => {
                    keys.push(['spawn', Object.keys(o), JSON.stringify(o), o.port, { ...o }.port])
                    fe.up[11007] = true
                    return { pid: 1 }
                },
                beforeSpawn: async (o) => keys.push(['before', Object.keys(o), o.port])
            }],
            env: {},
            probe: fe.probe,
            pollMs: 1,
            log: () => {},
        })
        await sm.startServersOnce()
        assert.strict.deepStrictEqual(Object.keys(sm), ['startServersOnce', 'restart', 'cleanup', 'state'])
        assert.strict.equal(sm.portOf('b'), 11007)
        assert.strict.deepStrictEqual(keys[0], ['before', ['phase', 'args', 'env', 'hookArg'], 11007])
        assert.strict.deepStrictEqual(keys[1].slice(0, 2), ['spawn', ['args', 'env']])
        assert.strict.deepStrictEqual([keys[1][3], keys[1][4]], [11007, undefined])
        assert.ok(!keys[1][2].includes('"port"'))
    })

    it('[P05] 實跑: E2E_PORT_OFFSET=100 時服務以 spawn 收到之實際埠(19030)啟動, 預設探測與 baseUrl 皆指向之, 基準埠(18930)無人監聽; cleanup 後釋放', async function() {
        this.timeout(30000)
        let base = 18930
        let env = { E2E_PORT_OFFSET: '100' }
        let port = resolveE2ePort(base, { env })
        assert.strict.equal(port, 19030)
        assert.strict.deepStrictEqual([await canConnect(base), await canConnect(port)], [false, false], '測試用埠須空閒')
        let code = 'require("http").createServer((q,s)=>s.end("svc:"+process.argv[1])).listen(+process.argv[1],"127.0.0.1")'
        let sm = createServiceManager({
            services: [{ name: 'svc', port: base, readyTimeoutMs: 15000, spawn: ({ port: p }) => spawn(process.execPath, ['-e', code, String(p)], { stdio: 'ignore', windowsHide: true }) }],
            env,
            log: () => {},
        })
        try {
            await sm.startServersOnce()
            assert.strict.deepStrictEqual([sm.state('svc').owned, sm.portOf('svc')], [true, 19030])
            let baseUrl = `http://127.0.0.1:${resolveE2ePort(base, { env })}`
            let res = await fetch(`${baseUrl}/`)
            assert.strict.equal(await res.text(), 'svc:19030')
            assert.strict.equal(await canConnect(base), false)
        }
        finally {
            sm.cleanup()
        }
        let t0 = Date.now()
        while (await canConnect(port) && Date.now() - t0 < 5000) {
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
        assert.strict.equal(await canConnect(port), false)
    })

})
