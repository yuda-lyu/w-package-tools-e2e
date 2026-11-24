//createCdnLocal 相關測試之共用夾具(unit-createCdnLocal、api-createCdnLocal、e2e-createCdnLocal、unit-genCdnManifest、api-genCdnManifest 共用, 同一 helper 只定義一次)
//  夾具之「外部網址」為 https://cdn.fixture.invalid(不可解析之主機, 不連外網), 下載時以 opt.fetch 改接本機夾具伺服器
import http from 'http'
import crypto from 'crypto'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

let __dir = path.dirname(fileURLToPath(import.meta.url))

export let HOST = 'https://cdn.fixture.invalid'
export let CHILD = path.resolve(__dir, 'cdnAcquireChild.mjs')

//模組載入時保存之原生 fetch(測試中途 patchFetch 覆寫全域 fetch 後仍可直連本機夾具伺服器)
export let realFetch = globalThis.fetch

export let sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

export let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

//事件同步: 輪詢可觀察條件(非固定延時後斷言), 逾時即失敗並帶說明
export async function waitUntil(cond, ms, what) {
    let t0 = Date.now()
    while (!cond()) {
        if (Date.now() - t0 > ms) {
            throw new Error('等候逾時: ' + what)
        }
        await sleep(20)
    }
}

export function deferred() {
    let release
    let promise = new Promise((resolve) => {
        release = resolve
    })
    return { promise, resolve: release }
}

//夾具: n 個逐檔相異(內容與長度皆不同)之經典腳本, 與其清單; 第 i 檔執行後設定 window.__fx<i> = 'v<i>'
export function makeFixture(n = 6) {
    let bodies = {}
    let files = {}
    for (let i = 0; i < n; i++) {
        let body = Buffer.from(`window.__fx${i}='v${i}';/* fixture ${i} */` + String.fromCharCode(97 + i).repeat(500 + i * 137) + `/*#${i * 7919}*/`)
        let p = `/pkg-${i}@1.0.${i}/dist/f${i}.js`
        bodies[p] = body
        files[HOST + p] = { sha256: sha(body), size: body.length }
    }
    return { bodies, manifest: { schema: 1, roots: {}, files } }
}

//夾具(ESM): main 以相對路徑匯入 dep(chunk 式), 另有 css; 回傳 bodies 與清單
export function makeEsmFixture() {
    let dep = Buffer.from('export const dep = \'dep-value\'\nexport default { name: \'dep\' }\n')
    let main = Buffer.from('import { dep } from \'./chunk/dep.mjs\'\nexport const main = \'main+\' + dep\n')
    let css = Buffer.from('.fx{color:rgb(1,2,3)}\n')
    let bodies = { '/esm@1.0.0/main.mjs': main, '/esm@1.0.0/chunk/dep.mjs': dep, '/esm@1.0.0/style.css': css }
    let files = {}
    for (let [p, b] of Object.entries(bodies)) {
        files[HOST + p] = { sha256: sha(b), size: b.length }
    }
    return { bodies, manifest: { schema: 1, roots: {}, files } }
}

//夾具伺服器: 記錄每個路徑之請求次數; gate 給了則所有請求等 gate 放行才回應; delayMs 為每個請求之延遲
//  bodies 為 { 路徑: Buffer | { status, body, type } }, 路徑含查詢字串時以完整 req.url 比對; type 為回應之 content-type(預設 application/javascript)
export async function startServer(bodies, gate, delayMs = 0) {
    let hits = {}
    let server = http.createServer(async (req, res) => {
        hits[req.url] = (hits[req.url] || 0) + 1
        if (gate) {
            await gate.promise
        }
        if (delayMs) {
            await sleep(delayMs)
        }
        let b = bodies[req.url]
        let status = 200
        let type = 'application/javascript'
        if (b && !Buffer.isBuffer(b) && typeof b === 'object') {
            status = b.status || 200
            type = b.type || type
            b = b.body
        }
        if (!b) {
            res.writeHead(404)
            res.end()
            return
        }
        res.writeHead(status, { 'content-length': String(b.length), 'content-type': type })
        res.end(b)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    let baseUrl = 'http://127.0.0.1:' + server.address().port
    return {
        hits,
        baseUrl,
        fetch: (u, init) => realFetch(String(u).replace(HOST, baseUrl), init),
        close: () => new Promise((resolve) => {
            server.closeAllConnections()
            server.close(resolve)
        }),
    }
}

//起子行程 cdnAcquireChild: 事件逐行解析成 events, done 為結束時之 { code, out, err }
export function spawnChild(manifestFp, cacheDir, baseUrl, extra = []) {
    let events = []
    let p = spawn(process.execPath, [CHILD, manifestFp, cacheDir, baseUrl, ...extra], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    let err = ''
    let out = ''
    p.stdout.on('data', (d) => {
        buf += d
        out += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
            let line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (line.startsWith('EV ')) {
                events.push(JSON.parse(line.slice(3)))
            }
        }
    })
    p.stderr.on('data', (d) => {
        err += d
    })
    let done = new Promise((resolve) => p.on('close', (code) => resolve({ code, out, err })))
    return { events, done, kill: () => p.kill(), pid: p.pid }
}

//取得一個確實已結束(行程不存在)之 pid: 結束後再以 process.kill(pid, 0) 確認, 避免 pid 被重新配發
export function deadPid() {
    for (let i = 0; i < 20; i++) {
        let r = spawnSync(process.execPath, ['--version'], { windowsHide: true })
        try {
            process.kill(r.pid, 0)
        }
        catch (err) {
            if (err.code === 'ESRCH') {
                return r.pid
            }
        }
    }
    throw new Error('取不到已結束之 pid')
}

//最小 WebSocket 伺服器: 完成升級握手後送一則文字訊息 'hello'(不依賴 ws 套件); 回傳 { url, hits, close }
export async function startWsServer() {
    let hits = 0
    let socks = new Set()
    let server = http.createServer((req, res) => {
        res.writeHead(426)
        res.end()
    })
    server.on('upgrade', (req, socket) => {
        hits++
        socks.add(socket)
        socket.on('error', () => {})
        socket.on('close', () => socks.delete(socket))
        let key = req.headers['sec-websocket-key']
        let accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
        socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + accept, '', ''].join('\r\n'))
        socket.write(Buffer.concat([Buffer.from([0x81, 5]), Buffer.from('hello')]))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return {
        url: 'ws://127.0.0.1:' + server.address().port,
        get hits() {
            return hits
        },
        close: () => new Promise((resolve) => {
            for (let s of socks) {
                s.destroy()
            }
            server.closeAllConnections()
            server.close(resolve)
        }),
    }
}
