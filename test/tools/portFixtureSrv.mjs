//自動換埠實機測試之夾具服務: 真實監聽。
//  node portFixtureSrv.mjs back <埠>                 後端: 回傳自身之埠與 PID
//  node portFixtureSrv.mjs front <埠> <後端基準埠>   前端: 依繼承之 E2E_PORT_OFFSET 找後端(同 vue.config.js 之 proxy), 回傳自身與後端之回應
//  node portFixtureSrv.mjs occupant <埠> [位址]      占用者: 由測試自建, 回傳固定標記
import http from 'http'

let [role, portArg, arg3] = process.argv.slice(2)
let port = Number(portArg)
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
srv.listen(port, host)
