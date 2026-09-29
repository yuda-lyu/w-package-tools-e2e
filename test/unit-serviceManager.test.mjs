import assert from 'assert'
import createServiceManager from '../src/createServiceManager.mjs'


//生命週期管理器之單元測試(假 spawn / probe / kill, 不啟動任何行程): 沿用、spawn、失敗語意、並發、restart 兩分支、cleanup


//假環境: up[port] 代表該 port 是否有回應; spawn 後依 readyAfter 次探測轉為 up
function fakeEnv() {
    let env = {
        up: {},
        spawns: [],
        kills: [],
        listenerKills: [],
        probes: 0,
        readyAfter: {}, //port → 還要幾次探測才 up (Infinity 代表永不就緒)
    }
    env.probe = async (svc) => {
        env.probes++
        let p = svc.port
        if (!env.up[p] && env.readyAfter[p] !== undefined) {
            env.readyAfter[p]--
            if (env.readyAfter[p] <= 0) env.up[p] = true
        }
        return !!env.up[p]
    }
    env.spawnOf = (name, port, readyAfter = 1) => ({ args, env: e }) => {
        let child = { pid: 1000 + env.spawns.length, name, exitCode: null, signalCode: null }
        env.spawns.push({ name, args, env: e })
        env.readyAfter[port] = readyAfter
        return child
    }
    env.killTree = (child) => {
        env.kills.push(child.name)
        let port = child.name === 'backend' ? 11007 : 8080
        env.up[port] = false
        delete env.readyAfter[port]
    }
    env.killListeners = (port) => {
        env.listenerKills.push(port)
        env.up[port] = false
        return { pids: ['9'], killed: ['9'] }
    }
    return env
}

function mkSm(env, over = {}) {
    return createServiceManager({
        services: [
            { name: 'backend', port: 11007, readyTimeoutMs: 80, spawn: env.spawnOf('backend', 11007) },
            { name: 'frontend', port: 8080, readyTimeoutMs: 80, spawn: env.spawnOf('frontend', 8080) },
        ],
        probe: env.probe,
        pollMs: 1,
        portReleaseTimeoutMs: 50,
        portReleasePollMs: 1,
        killTree: env.killTree,
        killListeners: env.killListeners,
        log: () => {},
        ...over,
    })
}


describe('createServiceManager', function() {

    it('port 已有服務即沿用: 不 spawn、cleanup 不殺', async function() {
        let env = fakeEnv()
        env.up[11007] = true
        env.up[8080] = true
        let sm = mkSm(env)
        await sm.startServersOnce()
        assert.strict.equal(env.spawns.length, 0)
        assert.strict.deepStrictEqual(sm.state('backend'), { owned: false, pid: null, attempted: true })
        sm.cleanup()
        assert.strict.deepStrictEqual(env.kills, [])
    })

    it('port 無人即 spawn 並等就緒; 之後之呼叫不再探測; cleanup 依反序殺自建並重置, 之後重新偵測', async function() {
        let env = fakeEnv()
        let cleaned = 0
        let sm = mkSm(env, { onCleanup: () => cleaned++ })
        await sm.startServersOnce()
        assert.strict.deepStrictEqual(env.spawns.map((s) => [s.name, s.args, s.env === process.env]), [['backend', [], true], ['frontend', [], true]])
        let probes = env.probes
        await sm.startServersOnce()
        assert.strict.equal(env.probes, probes)
        sm.cleanup()
        assert.strict.deepStrictEqual(env.kills, ['frontend', 'backend'])
        assert.strict.equal(cleaned, 1)
        assert.strict.deepStrictEqual(sm.state('backend'), { owned: false, pid: null, attempted: false })
        await sm.startServersOnce()
        assert.strict.equal(env.spawns.length, 4)
    })

    it('就緒逾時: 首次呼叫拋出含 port 之錯誤; failureMode once 之後之呼叫不重試不拋錯, 並補起尚未處理之服務', async function() {
        let env = fakeEnv()
        let services = [
            { name: 'backend', port: 11007, readyTimeoutMs: 30, spawn: env.spawnOf('backend', 11007, Infinity) },
            { name: 'frontend', port: 8080, readyTimeoutMs: 80, spawn: env.spawnOf('frontend', 8080) },
        ]
        let sm = mkSm(env, { services })
        await assert.rejects(sm.startServersOnce(), /server not ready on port 11007 after 0\.03s/)
        assert.strict.deepStrictEqual(env.spawns.map((s) => s.name), ['backend'])
        await sm.startServersOnce()
        assert.strict.deepStrictEqual(env.spawns.map((s) => s.name), ['backend', 'frontend'])
        sm.cleanup()
        assert.strict.deepStrictEqual(env.kills, ['frontend', 'backend']) //未就緒之自建行程亦由 cleanup 殺
    })

    it('failureMode sticky: 之後之呼叫持續拋出同一錯誤, 直到 cleanup', async function() {
        let env = fakeEnv()
        let sm = mkSm(env, { failureMode: 'sticky', services: [{ name: 'backend', port: 11007, readyTimeoutMs: 30, spawn: env.spawnOf('backend', 11007, Infinity) }] })
        await assert.rejects(sm.startServersOnce(), /not ready/)
        await assert.rejects(sm.startServersOnce(), /not ready/)
        assert.strict.equal(env.spawns.length, 1)
        sm.cleanup()
        env.readyAfter = {}
        env.up[11007] = true
        await sm.startServersOnce()
    })

    it('並發呼叫共用同一個進行中之啟動(只 spawn 一次, 兩者皆等到就緒)', async function() {
        let env = fakeEnv()
        let sm = mkSm(env, { services: [{ name: 'backend', port: 11007, readyTimeoutMs: 200, spawn: env.spawnOf('backend', 11007, 3) }] })
        await Promise.all([sm.startServersOnce(), sm.startServersOnce()])
        assert.strict.equal(env.spawns.length, 1)
        assert.strict.equal(env.up[11007], true)
    })

    it('only: 只處理指定服務', async function() {
        let env = fakeEnv()
        let sm = mkSm(env)
        await sm.startServersOnce({ only: ['backend'] })
        assert.strict.deepStrictEqual(env.spawns.map((s) => s.name), ['backend'])
    })

    it('restart(有自建): 殺自建樹 → 等 port 釋放 → 以 args 與合併後 env spawn; env 只作用於本次; 不改一次性狀態', async function() {
        let env = fakeEnv()
        let sm = mkSm(env)
        await sm.startServersOnce({ only: ['backend'] })
        await sm.restart('backend', { args: ['./test/_tmp/s.json'], env: { EM_SRC_PORT: '1' } })
        assert.strict.deepStrictEqual(env.kills, ['backend'])
        let last = env.spawns[env.spawns.length - 1]
        assert.strict.deepStrictEqual(last.args, ['./test/_tmp/s.json'])
        assert.strict.equal(last.env.EM_SRC_PORT, '1')
        assert.strict.equal(last.env.PATH, process.env.PATH)
        await sm.restart('backend', { args: ['./settings.json'] })
        assert.strict.equal(env.spawns[env.spawns.length - 1].env, process.env)
        assert.strict.equal(sm.state('backend').owned, true)
        assert.strict.deepStrictEqual(env.listenerKills, [])
    })

    it('restart(無自建而 port 被佔用): killForeignOnRestart=false 拋錯不殺; true 則殺監聽者後 spawn', async function() {
        let env = fakeEnv()
        env.up[11007] = true
        let sm = mkSm(env)
        await assert.rejects(sm.restart('backend'), /killForeignOnRestart=false/)
        assert.strict.deepStrictEqual(env.listenerKills, [])
        let sm2 = mkSm(env, { killForeignOnRestart: true })
        await sm2.restart('backend', { args: ['./settings.json'] })
        assert.strict.deepStrictEqual(env.listenerKills, [11007])
        assert.strict.equal(sm2.state('backend').owned, true)
    })

    it('restart 後再 startServersOnce: 沿用 restart 之自建實例(不重複 spawn), cleanup 仍殺它', async function() {
        let env = fakeEnv()
        env.up[8080] = true
        let sm = mkSm(env)
        await sm.restart('backend', { args: ['./settings.json'] })
        await sm.startServersOnce()
        assert.strict.equal(env.spawns.length, 1)
        sm.cleanup()
        assert.strict.deepStrictEqual(env.kills, ['backend'])
    })

    it('beforeSpawn: 只在確定要 spawn 時呼叫並等完才 spawn (沿用時不呼叫); restart 帶 phase=restart、合併後 env 與 hookArg', async function() {
        let env = fakeEnv()
        env.up[8080] = true
        let calls = []
        let beforeSpawn = async (o) => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            calls.push({ phase: o.phase, args: o.args, hookArg: o.hookArg, spawnsSoFar: env.spawns.length, em: o.env.EM_SRC_PORT })
        }
        let services = [
            { name: 'backend', port: 11007, readyTimeoutMs: 80, spawn: env.spawnOf('backend', 11007), beforeSpawn },
            { name: 'frontend', port: 8080, readyTimeoutMs: 80, spawn: env.spawnOf('frontend', 8080), beforeSpawn },
        ]
        let sm = mkSm(env, { services })
        await sm.startServersOnce()
        assert.strict.deepStrictEqual(calls, [{ phase: 'start', args: [], hookArg: null, spawnsSoFar: 0, em: process.env.EM_SRC_PORT }])
        await sm.restart('backend', { args: ['./s.json'], env: { EM_SRC_PORT: '1' }, hookArg: { reseed: true } })
        assert.strict.deepStrictEqual(calls[1], { phase: 'restart', args: ['./s.json'], hookArg: { reseed: true }, spawnsSoFar: 1, em: '1' })
        assert.strict.equal(env.spawns.length, 2)
    })

    it('restart(有自建但殺後 port 仍被佔): killForeignOnRestart=true 殺監聽者後 spawn; false 只記錄並照常 spawn', async function() {
        for (let kf of [true, false]) {
            let env = fakeEnv()
            //模擬另一個同專案實例: 殺自建樹後 port 仍有回應
            let killTree = (child) => {
                env.kills.push(child.name)
            }
            let sm = mkSm(env, { killForeignOnRestart: kf, killTree })
            await sm.startServersOnce({ only: ['backend'] })
            await sm.restart('backend', { args: ['./s.json'] })
            assert.strict.deepStrictEqual(env.kills, ['backend'])
            assert.strict.deepStrictEqual(env.listenerKills, kf ? [11007] : [], `kf=${kf}`)
            assert.strict.deepStrictEqual(env.spawns.map((s) => s.args), [[], ['./s.json']], `kf=${kf}`)
            assert.strict.equal(sm.state('backend').owned, true)
        }
    })

    it('參數檢查', function() {
        assert.throws(() => createServiceManager({ services: [] }), /services/)
        assert.throws(() => createServiceManager({ services: [{ name: 'a', port: 1 }] }), /spawn/)
        assert.throws(() => createServiceManager({ services: [{ name: 'a', port: 1, spawn: () => {} }], failureMode: 'x' }), /failureMode/)
        assert.throws(() => createServiceManager({ services: [{ name: 'a', port: 1, spawn: () => {}, beforeSpawn: 'x' }] }), /beforeSpawn/)
        let sm = createServiceManager({ services: [{ name: 'a', port: 1, spawn: () => {} }] })
        assert.throws(() => sm.state('b'), /無此服務/)
    })

})
