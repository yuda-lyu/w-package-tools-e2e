import probeHttp from './probeHttp.mjs'
import killOwnTree from './killOwnTree.mjs'
import killPortListeners from './killPortListeners.mjs'


/**
 * 建立e2e服務生命週期管理器(沿用政策reuse)：port已有服務即沿用(不spawn也不負責關)，沒有才spawn並等就緒；只殺自己spawn的
 *
 * startServersOnce：依services順序逐一處理；每個服務各自一個一次性狀態(進行中之呼叫共用同一個promise)。
 * 失敗語意failureMode：'once'(預設，首次呼叫拋錯，之後之呼叫不再重試也不再拋錯；沿用w-web-sso現行語意)或'sticky'(之後之呼叫持續拋出同一錯誤，直到cleanup)。
 * restart：有自建行程者先同步殺整棵樹並等port釋放(有上限)；等不到釋放、或無自建行程而port被佔用者，killForeignOnRestart為true才以killPortListeners殺監聽者
 * (只可用於該port專屬本專案且已於專案映射表明文登錄之情形)，否則拋錯(自建殺後仍被佔者只記錄並繼續，沿用前版語意)；之後以args與env(與process.env淺合併，只作用於本次)spawn並等就緒。restart不改變一次性狀態。
 * 服務可給beforeSpawn掛鉤(async({phase,args,env,hookArg}))：每次spawn之前呼叫並等待，phase為'start'(startServersOnce確定要spawn時)或'restart'，
 * hookArg為restart之opt.hookArg(例如{reseed:true})；用於須在服務啟動前完成之前置(例如資料庫須在後端開啟前重建)。
 * cleanup：同步(exit與訊號處理器內非同步不會被等待)；依services反序殺自建行程、重置所有一次性狀態(使之後之startServersOnce重新偵測)、呼叫onCleanup。
 * 另有政策own(只用自建實例、port被佔即報錯、跨行程互斥)未於本版提供，參考w-web-task之test/tools/harnessLifecycle.mjs
 *
 * @param {Object} opt 輸入設定物件
 * @param {Array} opt.services 輸入服務陣列，每個為{name,port,spawn({args,env})=>ChildProcess,readyTimeoutMs,url,startNote,beforeSpawn}，readyTimeoutMs預設30000，url預設http://<host>:<port>/，beforeSpawn可省略
 * @param {String} [opt.host='127.0.0.1'] 輸入主機字串，預設'127.0.0.1'
 * @param {Function} [opt.probe] 輸入就緒探測函數async(svc)=>Boolean，預設probeHttp(svc.url,{timeoutMs:1500})(任何HTTP回應即就緒)
 * @param {Number} [opt.pollMs=500] 輸入就緒輪詢間隔毫秒數，預設500
 * @param {String} [opt.failureMode='once'] 輸入啟動失敗後之語意字串，'once'或'sticky'，預設'once'
 * @param {Boolean} [opt.killForeignOnRestart=false] 輸入restart時可否殺非自建之port監聽者布林值，預設false
 * @param {Number} [opt.portReleaseTimeoutMs=5000] 輸入等待port釋放之上限毫秒數，預設5000
 * @param {Number} [opt.portReleasePollMs=200] 輸入等待port釋放之輪詢間隔毫秒數，預設200
 * @param {Function} [opt.killTree=killOwnTree] 輸入同步殺自建行程樹函數(child)，預設killOwnTree
 * @param {Function} [opt.killListeners=killPortListeners] 輸入同步殺port監聽者函數(port)=>{pids,killed}，預設killPortListeners
 * @param {Function} [opt.sleep] 輸入等待函數async(ms)，預設setTimeout
 * @param {Function} [opt.onCleanup=null] 輸入cleanup末尾之同步回呼(例如刪臨時設定檔)，預設null
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Object} 回傳物件{startServersOnce({only}),restart(name,{args,env,hookArg}),cleanup(),state(name)}
 * @example
 *
 * import { spawn } from 'child_process'
 * import createServiceManager from 'w-package-tools-e2e/src/createServiceManager.mjs'
 *
 * let sm = createServiceManager({
 *     services: [
 *         { name: 'backend', port: 11007, readyTimeoutMs: 30000, spawn: ({ args, env }) => spawn('node', ['srv.mjs', ...args], { stdio: 'ignore', env }) },
 *         { name: 'frontend', port: 8080, readyTimeoutMs: 90000, spawn: () => spawn('npm', ['run', 'serve'], { stdio: 'ignore', shell: true }) },
 *     ],
 *     killForeignOnRestart: true,
 * })
 * await sm.startServersOnce()
 * await sm.restart('backend', { args: ['./test/_tmp/settings-e2e.json'] })
 * sm.cleanup()
 *
 */
function createServiceManager(opt = {}) {
    let {
        services,
        host = '127.0.0.1',
        probe = null,
        pollMs = 500,
        failureMode = 'once',
        killForeignOnRestart = false,
        portReleaseTimeoutMs = 5000,
        portReleasePollMs = 200,
        killTree = killOwnTree,
        killListeners = killPortListeners,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onCleanup = null,
        log = console.log,
    } = opt
    if (!Array.isArray(services) || services.length === 0) {
        throw new Error('createServiceManager: services 為必填陣列')
    }
    if (!['once', 'sticky'].includes(failureMode)) {
        throw new Error(`createServiceManager: failureMode 須為 once 或 sticky，實得「${failureMode}」`)
    }
    let svcs = services.map((s) => ({ readyTimeoutMs: 30000, url: `http://${host}:${s.port}/`, ...s }))
    let names = new Set()
    for (let s of svcs) {
        if (!s.name || !s.port || typeof s.spawn !== 'function') {
            throw new Error('createServiceManager: 每個服務須有 name、port、spawn')
        }
        if (s.beforeSpawn !== undefined && s.beforeSpawn !== null && typeof s.beforeSpawn !== 'function') {
            throw new Error(`createServiceManager: 服務 ${s.name} 之 beforeSpawn 須為函數`)
        }
        if (names.has(s.name)) {
            throw new Error(`createServiceManager: 服務名稱重複 ${s.name}`)
        }
        names.add(s.name)
    }
    let probeFn = probe || ((svc) => probeHttp(svc.url, { timeoutMs: 1500 }))
    let states = {}
    for (let s of svcs) {
        states[s.name] = { proc: null, pm: null }
    }
    let byName = (name) => {
        let s = svcs.find((x) => x.name === name)
        if (!s) {
            throw new Error(`createServiceManager: 無此服務 ${name}`)
        }
        return s
    }

    async function waitReady(svc) {
        let start = Date.now()
        while (Date.now() - start < svc.readyTimeoutMs) {
            if (await probeFn(svc)) {
                return
            }
            await sleep(pollMs)
        }
        throw new Error(`server not ready on port ${svc.port} after ${svc.readyTimeoutMs / 1000}s`)
    }

    async function waitReleased(svc) {
        let start = Date.now()
        while (Date.now() - start < portReleaseTimeoutMs) {
            if (!(await probeFn(svc))) {
                return true
            }
            await sleep(portReleasePollMs)
        }
        log(`[e2e-setup] port ${svc.port} 於 ${portReleaseTimeoutMs}ms 內仍有回應, 照常繼續`)
        return false
    }

    async function ensure(svc) {
        if (await probeFn(svc)) {
            log(`[e2e-setup] ${svc.name} already running on ${svc.port}, reusing`)
            return
        }
        log(`[e2e-setup] starting ${svc.name} (port ${svc.port})${svc.startNote ? `, ${svc.startNote}` : ''}...`)
        if (svc.beforeSpawn) {
            await svc.beforeSpawn({ phase: 'start', args: [], env: process.env, hookArg: null })
        }
        states[svc.name].proc = svc.spawn({ args: [], env: process.env })
        await waitReady(svc)
        log(`[e2e-setup] ${svc.name} ready`)
    }

    async function startServersOnce(o = {}) {
        let { only = null } = o
        let list = only ? svcs.filter((s) => only.includes(s.name)) : svcs
        for (let svc of list) {
            let st = states[svc.name]
            if (st.pm) {
                if (failureMode === 'sticky') {
                    await st.pm
                }
                else {
                    await st.pm.catch(() => {})
                }
                continue
            }
            st.pm = ensure(svc)
            await st.pm
        }
    }

    function killForeign(svc) {
        let r = killListeners(svc.port)
        if (r && r.pids === null) {
            log(`[e2e-setup] 查詢 port ${svc.port} 監聽者之工具不可用, 未殺`)
        }
    }

    async function restart(name, o = {}) {
        let { args = [], env = null, hookArg = null } = o
        let svc = byName(name)
        let st = states[name]
        if (st.proc) {
            killTree(st.proc)
            let released = await waitReleased(svc)
            //自建已殺而 port 仍有回應: 另有同專案實例佔用 (例如手動啟動者); 允許時殺其監聽者, 否則沿前版只記錄並繼續
            if (!released && killForeignOnRestart) {
                killForeign(svc)
                await waitReleased(svc)
            }
        }
        else if (await probeFn(svc)) {
            if (!killForeignOnRestart) {
                throw new Error(`restart ${name}: port ${svc.port} 被非本行程建立之服務佔用, 且未允許殺外部行程 (killForeignOnRestart=false)`)
            }
            killForeign(svc)
            await waitReleased(svc)
        }
        st.proc = null
        let spawnEnv = env ? { ...process.env, ...env } : process.env
        if (svc.beforeSpawn) {
            await svc.beforeSpawn({ phase: 'restart', args, env: spawnEnv, hookArg })
        }
        st.proc = svc.spawn({ args, env: spawnEnv })
        await waitReady(svc)
    }

    function cleanup() {
        for (let svc of [...svcs].reverse()) {
            let st = states[svc.name]
            if (st.proc) {
                try {
                    killTree(st.proc)
                }
                catch (err) {}
                st.proc = null
            }
            st.pm = null
        }
        if (typeof onCleanup === 'function') {
            onCleanup()
        }
    }

    function state(name) {
        let st = states[byName(name).name]
        return { owned: !!st.proc, pid: st.proc ? st.proc.pid : null, attempted: !!st.pm }
    }

    return { startServersOnce, restart, cleanup, state }
}


export default createServiceManager
