//自動換埠實機測試之夾具: 模擬一個套件之單開 e2e 啟動(真實行程、真實監聽), 流程同使用端之 e2e-setup。
//環境變數: PF_PORTS=後端基準埠,前端基準埠; PF_RECORD 紀錄檔(JSONL); PF_GATE 閘門檔(存在才收尾); PF_OPTS reserveE2ePorts 之選項(JSON);
//  PF_EARLY=1 保留前先取實際埠(誤用); PF_STAGE=hold-before-start 保留後先等 PF_GATE0 才啟動; PF_RESTART=1 啟動失敗後改試 restart; PF_CHILD=1 由子行程(繼承保留)再跑一次
import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import reserveE2ePorts from '../../src/reserveE2ePorts.mjs'
import resolveE2ePort from '../../src/resolveE2ePort.mjs'
import createServiceManager from '../../src/createServiceManager.mjs'

let fpSrv = fileURLToPath(new URL('./portFixtureSrv.mjs', import.meta.url))
let fpSelf = fileURLToPath(import.meta.url)
let [back, front] = process.env.PF_PORTS.split(',').map(Number)
let opts = JSON.parse(process.env.PF_OPTS || '{}')
let record = (o) => fs.appendFileSync(process.env.PF_RECORD, `${JSON.stringify({ pid: process.pid, tag: process.env.PF_TAG || '', ...o })}\n`)
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFile(fp) {
    let t0 = Date.now()
    while (Date.now() - t0 < 150000) {
        if (fs.existsSync(fp)) {
            return
        }
        await sleep(50)
    }
    throw new Error(`gate timeout: ${fp}`)
}

if (process.env.PF_EARLY === '1') {
    resolveE2ePort(back)
}
let res
try {
    //E1: 全部入口經共用函式; 須在任何 resolveE2ePort 之前
    res = reserveE2ePorts([back, front], opts)
}
catch (err) {
    record({ stage: 'reserve-error', code: err.code || '', message: err.message })
    process.exit(5)
}
//E3: 前端、後端之實際埠皆由環境變數之位移衍生
let baseUrl = `http://127.0.0.1:${resolveE2ePort(front)}/`
record({ stage: 'reserved', offset: res.offset, source: res.source, ports: res.ports, baseUrl })
if (process.env.PF_STAGE === 'hold-before-start') {
    await waitFile(process.env.PF_GATE0)
}

//PF_SHELL=1: 同 npm run serve 之 shell:true(Windows 之 libuv job 只連帶殺直屬子行程, 持有者被硬殺時服務成孤兒)
let startSrv = (args, env) => (process.env.PF_SHELL === '1'
    ? spawn(`node "${fpSrv}" ${args.join(' ')}`, { stdio: 'ignore', windowsHide: true, env, shell: true })
    : spawn(process.execPath, [fpSrv, ...args], { stdio: 'ignore', windowsHide: true, env }))
let sm = createServiceManager({
    killForeignOnRestart: process.env.PF_RESTART === '1',
    services: [
        { name: 'back', port: back, spawn: ({ port, env }) => startSrv(['back', String(port)], env) },
        { name: 'front', port: front, spawn: ({ port, env }) => startSrv(['front', String(port), String(back)], env) },
    ],
})

let exitCode = 0
try {
    await sm.startServersOnce()
    let j = await (await fetch(baseUrl)).json()
    record({ stage: 'up', served: j, backPid: sm.state('back').pid, frontPid: sm.state('front').pid })
    if (process.env.PF_CHILD === '1') {
        //PF_CHILD_RESTART=1: 子行程 restart 上層起之後端(無自建行程, 依身分確認後才殺); 先等背景取樣把服務記入預約檔
        if (process.env.PF_CHILD_RESTART === '1') {
            let fp = path.join(process.env.E2E_PORT_REG_DIR, `p${res.ports[0]}.json`)
            let t0 = Date.now()
            let has = () => {
                try {
                    return JSON.parse(fs.readFileSync(fp, 'utf8')).known.some((k) => k.pid === j.backend.pid)
                }
                catch (err) {
                    return false
                }
            }
            while (!has() && Date.now() - t0 < 60000) {
                await sleep(50)
            }
        }
        let r = spawnSync(process.execPath, [fpSelf], { env: { ...process.env, PF_CHILD: '', PF_TAG: 'child', PF_GATE: '', PF_REUSE_ONLY: '1', PF_RESTART: process.env.PF_CHILD_RESTART || '' }, stdio: 'ignore', windowsHide: true })
        record({ stage: 'child-exit', status: r.status })
    }
    if (process.env.PF_REUSE_ONLY === '1' && process.env.PF_RESTART === '1') {
        await sm.restart('back')
        let j2 = await (await fetch(baseUrl)).json()
        record({ stage: 'restarted', oldBackPid: j.backend.pid, served: j2 })
    }
    if (process.env.PF_REUSE_ONLY !== '1') {
        await waitFile(process.env.PF_GATE)
    }
}
catch (err) {
    record({ stage: 'start-error', message: err.message })
    exitCode = 6
    if (process.env.PF_RESTART === '1') {
        try {
            await sm.restart('back')
            record({ stage: 'restart-ok' })
        }
        catch (e2) {
            record({ stage: 'restart-error', message: e2.message })
        }
    }
}
sm.cleanup()
record({ stage: 'done' })
process.exit(exitCode)
