//自動換埠實機測試之夾具服務: 真實監聽。
//  node portFixtureSrv.mjs back <埠>                 後端: 回傳自身之埠與 PID
//  node portFixtureSrv.mjs front <埠> <後端基準埠>   前端: 依繼承之 E2E_PORT_OFFSET 找後端(同 vue.config.js 之 proxy), 回傳自身與後端之回應
//  node portFixtureSrv.mjs occupant <埠> [位址] [v6only]  占用者: 由測試自建, 回傳固定標記; 第 4 參數 v6only＝位址 :: 且 ipv6Only(不與雙棧 :: 同形, 四種舊試綁定皆偵測不到)
//  node portFixtureSrv.mjs tcp <埠> [位址]           占用者(非 HTTP): 接受連線後不回應, HTTP 探測一直不通
//  node portFixtureSrv.mjs portfinder <埠>           同 vue-cli 之 portfinder: 埠被占用就靜默改用下一個
//  node portFixtureSrv.mjs dual <埠>                 同一行程監聽 127.0.0.1 與 ::1
//  node portFixtureSrv.mjs launcher <埠>             launcher 仍在: 自身不監聽, 由子行程(back)監聽
//  node portFixtureSrv.mjs launcher-exit <埠>        launcher 先結束: 起 detached 之 back, 就緒後自身結束
import http from 'http'
import net from 'net'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

let [role, portArg, arg3, arg4] = process.argv.slice(2)
let port = Number(portArg)
let fpSelf = fileURLToPath(import.meta.url)
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let reply = (s, p) => {
    s.setHeader('content-type', 'application/json')
    s.end(JSON.stringify({ role, port: p, pid: process.pid }))
}

//不合法之 launcher: 服務由 detached 之行程接手後, 自身立即結束
async function launcherExit() {
    let child = spawn(process.execPath, [fpSelf, 'back', String(port)], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    let t0 = Date.now()
    while (Date.now() - t0 < 30000) {
        try {
            await (await fetch(`http://127.0.0.1:${port}/`)).text()
            process.exit(0)
        }
        catch (err) {}
        await sleep(50)
    }
    process.exit(4)
}

if (role === 'launcher') {
    let child = spawn(process.execPath, [fpSelf, 'back', String(port)], { stdio: 'ignore', windowsHide: true })
    child.once('exit', (code) => process.exit(code === null ? 1 : code))
    setInterval(() => {}, 60000)
}
else if (role === 'launcher-exit') {
    await launcherExit()
}
else if (role === 'tcp') {
    let srv = net.createServer(() => {})
    srv.on('error', () => process.exit(3))
    srv.listen(port, arg3 || '127.0.0.1')
}
else if (role === 'portfinder') {
    let listen = (p) => {
        let srv = http.createServer((q, s) => reply(s, p))
        srv.once('error', () => listen(p + 1))
        srv.listen(p, '127.0.0.1')
    }
    listen(port)
}
else if (role === 'dual') {
    for (let host of ['127.0.0.1', '::1']) {
        let srv = http.createServer((q, s) => reply(s, port))
        srv.on('error', (err) => {
            console.error(`bind failed: ${err.code}`)
            process.exit(3)
        })
        srv.listen(port, host)
    }
}
else {
    let host = role === 'occupant' && arg3 ? arg3 : '127.0.0.1'
    let handler = async (q, s) => {
        let body = { role, port, pid: process.pid }
        if (role === 'front') {
            let backPort = Number(arg3) + Number(process.env.E2E_PORT_OFFSET || 0)
            body.backend = await (await fetch(`http://127.0.0.1:${backPort}/`)).json()
        }
        s.setHeader('content-type', 'application/json')
        s.end(JSON.stringify(body))
    }
    let srv = http.createServer((q, s) => {
        handler(q, s).catch((err) => {
            s.statusCode = 500
            s.end(JSON.stringify({ role, port, pid: process.pid, error: err.message }))
        })
    })
    srv.on('error', (err) => {
        console.error(`bind failed: ${err.code}`)
        process.exit(3)
    })
    if (role === 'occupant' && arg4 === 'v6only') {
        srv.listen({ port, host, ipv6Only: true })
    }
    else {
        srv.listen(port, host)
    }
}
