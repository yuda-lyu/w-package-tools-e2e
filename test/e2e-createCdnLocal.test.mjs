import fs from 'fs'
import path from 'path'
import http from 'http'
import assert from 'assert'
import { fileURLToPath } from 'url'
import wpw from 'w-playwright'
import launchBrowser from '../src/launchBrowser.mjs'
import createCdnLocal from '../src/createCdnLocal.mjs'
import { HOST, sha, makeFixture, makeEsmFixture, startServer, startWsServer, waitUntil } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md R-CL-4(瀏覽器端: 清單內由本地副本回應、清單外中止並記錄、回送位址放行、ws(s)、非網路請求、與使用端自己之 route 並存)
//  真瀏覽器(headless shell)對本機頁面伺服器與夾具; 「外部網址」為 https://cdn.fixture.invalid 與 example.invalid(不可解析之主機), 路由於解析前攔截, 不連外網

let fdTmp = fileURLToPath(new URL('./_tmp/e2e-createCdnLocal/', import.meta.url))
let n = 0

//違規清單依網址去重(瀏覽器之預載掃描可能對同一網址發出兩次請求, 兩次皆被路由攔下並記錄)
let uniq = (vs) => [...new Set(vs.map((v) => v.url))]


//頁面伺服器(回送位址): 載入夾具腳本之頁面、含本站腳本與 API 之頁面
async function startSite() {
    let hits = {}
    let server = http.createServer((req, res) => {
        hits[req.url] = (hits[req.url] || 0) + 1
        if (req.url === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end('<!doctype html><title>t</title><p id="p">page</p><script src="/own.js"></script>')
        }
        else if (req.url === '/own.js') {
            res.writeHead(200, { 'content-type': 'application/javascript' })
            res.end('window.__own = "own-loaded"')
        }
        else if (req.url === '/redir') {
            res.writeHead(302, { location: 'https://example.invalid/redirected.js' })
            res.end()
        }
        else if (req.url === '/api') {
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
            res.end('{"ok":true}')
        }
        else {
            res.writeHead(404)
            res.end()
        }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return {
        hits,
        url: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise((resolve) => {
            server.closeAllConnections()
            server.close(resolve)
        }),
    }
}


describe('e2e-createCdnLocal', function() {
    this.timeout(120000)

    let fx = makeFixture(6)
    let esm = makeEsmFixture()
    let all = { schema: 1, roots: {}, files: { ...fx.manifest.files, ...esm.manifest.files } }
    let cdn = null
    let browser = null
    let site = null
    let mark = null
    let hookRestore = null

    //夾具伺服器只供一次性取得(其後關閉): 證明其後之頁面請求皆來自本地副本而非連網
    before(async function() {
        fs.mkdirSync(fdTmp, { recursive: true })
        let srv = await startServer({ ...fx.bodies, ...esm.bodies })
        try {
            cdn = createCdnLocal({ manifest: all, cacheDir: path.join(fdTmp, `cache-${++n}`), fetch: srv.fetch, retryDelayMs: 10 })
            await cdn.ensure()
        }
        finally {
            await srv.close()
        }
        site = await startSite()
    })

    beforeEach(function() {
        mark = cdn.violationMark()
    })

    afterEach(async function() {
        if (browser) {
            await browser.close().catch(() => {})
        }
        browser = null
        //[CE16c] 之啟動後鉤子為全域清單(同一 mocha 行程內之後續檔案亦受影響): 案卡住逾時時其 finally 尚未執行, 於此兜底還原(還原函數可重複呼叫)
        if (hookRestore) {
            hookRestore()
            hookRestore = null
        }
    })

    after(async function() {
        if (site) {
            await site.close()
        }
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    let open = async (c = cdn) => {
        browser = await launchBrowser()
        await c.routeBrowser(browser)
        return browser
    }

    it('[CE01] 清單內之 <script src> 與 <link rel=stylesheet> 由本地副本供應(全域已設定、位元組與 content-type 與本地副本相同), 無違規, 關閉不拋', async function() {
        await open()
        let page = await browser.newPage()
        let scripts = Object.keys(fx.manifest.files).map((u) => `<script src="${u}"></script>`).join('')
        await page.setContent(`<!doctype html>${scripts}<link rel="stylesheet" href="${HOST}/esm@1.0.0/style.css"><p id="x" class="fx">x</p>`, { waitUntil: 'load' })
        let got = await page.evaluate(() => [0, 1, 2, 3, 4, 5].map((i) => window['__fx' + i]))
        assert.deepStrictEqual(got, ['v0', 'v1', 'v2', 'v3', 'v4', 'v5'])
        assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('x')).color), 'rgb(1, 2, 3)', '樣式表(.fx)已由本地副本載入並套用')
        let u = HOST + '/pkg-3@1.0.3/dist/f3.js'
        let r = await page.evaluate(async (url) => {
            let res = await fetch(url)
            let buf = new Uint8Array(await res.arrayBuffer())
            return { status: res.status, type: res.type, ct: res.headers.get('content-type'), bytes: Array.from(buf) }
        }, u)
        assert.strictEqual(r.status, 200)
        assert.strictEqual(r.type, 'cors', '跨來源之 fetch 能讀到本體(非 opaque), 即 access-control-allow-origin 已正確回應')
        assert.ok(/javascript/.test(r.ct), r.ct)
        assert.strictEqual(sha(Buffer.from(r.bytes)), fx.manifest.files[u].sha256, '位元組與清單相同')
        assert.ok(cdn.stats().served.browser >= 7)
        cdn.assertNoViolation(mark)
        await browser.close() //無違規 → 不拋
        browser = null
    })

    it('[CE02] chunk 式 ESM: import() 與其相對匯入之 chunk 皆由本地副本供應(匯入鏈解析到清單內之網址)', async function() {
        await open()
        let page = await browser.newPage()
        await page.setContent('<p>esm</p>', { waitUntil: 'load' })
        let v = await page.evaluate(async (u) => (await import(u)).main, HOST + '/esm@1.0.0/main.mjs')
        assert.strictEqual(v, 'main+dep-value')
        cdn.assertNoViolation(mark)
        await browser.close()
        browser = null
    })

    it('[CE03] 清單外之外部請求被中止(頁面端見失敗), 並使 browser.close() 於關閉後拋 E_CDN_EXTERNAL、assertNoViolation 拋錯(含同網址不同查詢、同庫不同版本)', async function() {
        await open()
        let page = await browser.newPage()
        let other = HOST + '/pkg-0@1.0.0/dist/f0.js?v=2' //與清單內網址只差查詢
        let other2 = HOST + '/pkg-0@9.9.9/dist/f0.js' //同庫不同版本
        await page.setContent('<script src="https://example.invalid/a.js"></script>', { waitUntil: 'load' })
        let r = await page.evaluate(async (us) => {
            let out = []
            for (let u of us) {
                try {
                    await fetch(u)
                    out.push('ok')
                }
                catch (e) {
                    out.push('blocked')
                }
            }
            return out
        }, [other, other2])
        assert.deepStrictEqual(r, ['blocked', 'blocked'], '表外請求未被中止')
        assert.strictEqual(await page.evaluate(() => typeof window.__fx0), 'undefined')
        assert.throws(() => cdn.assertNoViolation(mark), (err) => err.code === 'E_CDN_EXTERNAL' && uniq(err.violations).length === 3) //瀏覽器之預載掃描可能對同一網址發出兩次請求, 故以網址去重
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => {
            assert.strictEqual(err.code, 'E_CDN_EXTERNAL')
            let urls = err.violations.map((v) => v.url)
            assert.ok(urls.includes('https://example.invalid/a.js') && urls.includes(other) && urls.includes(other2), '違規清單應含三筆: ' + urls)
            return true
        })
    })

    it('[CE04] browser.newContext() 另開之 context、browser.newPage()、以及直接傳入 context 或 page 者同樣受管控', async function() {
        await open()
        let ctx = await browser.newContext()
        let p1 = await ctx.newPage()
        await p1.setContent(`<script src="${HOST}/pkg-1@1.0.1/dist/f1.js"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await p1.evaluate(() => window.__fx1), 'v1', 'newContext 之頁面由本地副本供應')
        let p2 = await browser.newPage()
        await p2.setContent(`<script src="${HOST}/pkg-2@1.0.2/dist/f2.js"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await p2.evaluate(() => window.__fx2), 'v2', 'newPage 之頁面由本地副本供應')
        cdn.assertNoViolation(mark)
        await browser.close()
        browser = null

        //未經 routeBrowser(browser)之瀏覽器: 直接傳入 context
        browser = await launchBrowser()
        let c2 = await browser.newContext()
        await cdn.routeBrowser(c2)
        let p3 = await c2.newPage()
        await p3.setContent(`<script src="${HOST}/pkg-4@1.0.4/dist/f4.js"></script><script src="https://example.invalid/c.js"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await p3.evaluate(() => window.__fx4), 'v4')
        let closeErr = await c2.close().then(() => null, (e) => e)
        assert.ok(closeErr, 'context.close() 亦應於關閉後拋')
        assert.strictEqual(closeErr.code, 'E_CDN_EXTERNAL', closeErr.message)
        assert.deepStrictEqual(uniq(closeErr.violations), ['https://example.invalid/c.js'], 'context.close() 之違規清單')
        assert.throws(() => cdn.assertNoViolation(mark))

        //page
        mark = cdn.violationMark()
        let c3 = await browser.newContext()
        let p4 = await c3.newPage()
        await cdn.routeBrowser(p4, { failOnClose: false })
        await p4.setContent(`<script src="${HOST}/pkg-5@1.0.5/dist/f5.js"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await p4.evaluate(() => window.__fx5), 'v5', 'page: 路由掛在其 context')
        cdn.assertNoViolation(mark)
    })

    it('[CE05] 回送位址之請求原樣放行(頁面、本站腳本、API): 頁面自本機伺服器載入且與清單內之 CDN 腳本並存, 無違規', async function() {
        await open()
        let page = await browser.newPage()
        await page.goto(site.url + '/')
        assert.strictEqual(await page.evaluate(() => window.__own), 'own-loaded', '本站腳本放行')
        assert.strictEqual(await page.evaluate(async () => (await (await fetch('/api')).json()).ok), true, '本站 API 放行')
        await page.evaluate((u) => new Promise((resolve, reject) => {
            let s = document.createElement('script')
            s.src = u
            s.onload = resolve
            s.onerror = reject
            document.head.appendChild(s)
        }), HOST + '/pkg-0@1.0.0/dist/f0.js')
        assert.strictEqual(await page.evaluate(() => window.__fx0), 'v0', '同頁之清單內 CDN 腳本由本地副本供應')
        assert.ok(site.hits['/api'] >= 1)
        cdn.assertNoViolation(mark)
        await browser.close()
        browser = null
    })

    it('[CE06] allowLoopback:false 時回送位址亦視為外部(頁面對本機 API 之請求被中止並記錄); allow 明列者放行', async function() {
        let strict = createCdnLocal({ manifest: all, cacheDir: cdn.cacheDir, allowLoopback: false, allow: [new RegExp('^' + site.url.replace(/[.:/]/g, '\\$&') + '/api$')] })
        await strict.ensure()
        await open(strict)
        let page = await browser.newPage()
        await page.setContent('<p>x</p>', { waitUntil: 'load' })
        let m = strict.violationMark()
        let r = await page.evaluate(async (base) => {
            let out = {}
            for (let p of ['/api', '/own.js']) {
                try {
                    await fetch(base + p, { mode: 'no-cors' })
                    out[p] = 'ok'
                }
                catch (e) {
                    out[p] = 'blocked'
                }
            }
            return out
        }, site.url)
        assert.deepStrictEqual(r, { '/api': 'ok', '/own.js': 'blocked' })
        assert.throws(() => strict.assertNoViolation(m), (err) => JSON.stringify(uniq(err.violations)) === JSON.stringify([site.url + '/own.js']))
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
    })

    it('[CE07] ws(s): 外部連線被關閉並記錄為違規(kind websocket); 回送位址之連線放行且可收到訊息', async function() {
        let ws = await startWsServer()
        try {
            await open()
            let page = await browser.newPage()
            await page.setContent('<p>ws</p>', { waitUntil: 'load' })
            let okMsg = await page.evaluate((url) => new Promise((resolve) => {
                let s = new WebSocket(url)
                s.onmessage = (e) => resolve(e.data)
                s.onerror = () => resolve('error')
                s.onclose = () => resolve('closed')
            }), ws.url)
            assert.strictEqual(okMsg, 'hello', '回送位址之 ws 放行')
            assert.strictEqual(ws.hits, 1)
            cdn.assertNoViolation(mark)
            let closed = await page.evaluate(() => new Promise((resolve) => {
                let s = new WebSocket('wss://example.invalid/socket')
                s.onclose = (e) => resolve('closed:' + e.code)
                s.onerror = () => {}
            }))
            assert.ok(/^closed:/.test(closed), '外部 ws 應被關閉: ' + closed)
            assert.throws(() => cdn.assertNoViolation(mark), (err) => err.violations.length === 1 && err.violations[0].kind === 'websocket' && err.violations[0].url.startsWith('wss://example.invalid/'))
            let bro = browser
            browser = null
            await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
        }
        finally {
            await ws.close()
        }
    })

    it('[CE08] 非網路請求(data:、about:blank)不屬外部請求, 不計違規', async function() {
        await open()
        let page = await browser.newPage()
        await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent('<p id="x">ok</p>'))
        assert.strictEqual(await page.evaluate(() => document.getElementById('x').textContent), 'ok')
        await page.goto('about:blank')
        cdn.assertNoViolation(mark)
        await browser.close()
        browser = null
    })

    it('[CE09] 本地副本不可用(離線且快取缺檔): 清單內之請求亦被中止並記為違規(不放行外網), 頁面載入失敗、關閉時拋 E_CDN_EXTERNAL', async function() {
        let off = createCdnLocal({ manifest: all, cacheDir: path.join(fdTmp, `cache-${++n}`), offline: true })
        await open(off)
        let page = await browser.newPage()
        let failed = []
        page.on('requestfailed', (r) => failed.push(r.url()))
        await page.setContent(`<script src="${HOST}/pkg-0@1.0.0/dist/f0.js"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await page.evaluate(() => typeof window.__fx0), 'undefined', '腳本不得執行')
        assert.ok(failed.includes(HOST + '/pkg-0@1.0.0/dist/f0.js'), '請求應失敗: ' + failed)
        assert.throws(() => off.assertNoViolation(), (err) => JSON.stringify(uniq(err.violations)) === JSON.stringify([HOST + '/pkg-0@1.0.0/dist/f0.js']) && err.violations.every((v) => /本地副本不可用/.test(v.reason)))
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
    })

    it('[CE11] 專用 Worker 發出之請求同樣經路由: 清單內者由本地副本供應, 清單外者中止並記錄', async function() {
        await open()
        let page = await browser.newPage()
        await page.goto(site.url + '/')
        let r = await page.evaluate(async ([u, ext]) => {
            let src = `self.onmessage = async () => { let ok = (await (await fetch(${JSON.stringify(u)})).text()).startsWith("window.__fx0='v0'"); let blocked = 'ok'; try { await fetch(${JSON.stringify(ext)}) } catch (e) { blocked = 'blocked' } postMessage({ ok, blocked }) }`
            let w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })))
            return await new Promise((resolve, reject) => {
                w.onmessage = (e) => resolve(e.data)
                w.onerror = (e) => reject(new Error('worker error ' + e.message))
                w.postMessage(1)
            })
        }, [HOST + '/pkg-0@1.0.0/dist/f0.js', 'https://example.invalid/from-worker.js'])
        assert.deepStrictEqual(r, { ok: true, blocked: 'blocked' })
        assert.throws(() => cdn.assertNoViolation(mark), (err) => JSON.stringify(uniq(err.violations)) === JSON.stringify(['https://example.invalid/from-worker.js']))
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
    })

    it('[CE12] 放行之回送位址回 3xx 導向外部: route 處理器看不到該後續請求, 由 request 事件之觀察者記為違規(重新導向); 只記錄(來不及中止)', async function() {
        await open()
        let page = await browser.newPage()
        await page.goto(site.url + '/')
        await page.evaluate((u) => new Promise((resolve) => {
            let s = document.createElement('script')
            s.src = u
            s.onload = resolve
            s.onerror = resolve //外部網址不可解析, 載入失敗亦算結束
            document.head.appendChild(s)
        }), site.url + '/redir')
        assert.ok(site.hits['/redir'] >= 1, '放行之回送位址之請求照常送出')
        assert.throws(() => cdn.assertNoViolation(mark), (err) => JSON.stringify(uniq(err.violations)) === JSON.stringify(['https://example.invalid/redirected.js']) && /重新導向/.test(err.violations[0].reason))
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
    })

    it('[CE13] 使用端於 routeBrowser 之後才註冊之 route(其先於本處理器執行)以 continue() 放走外部請求: 請求雖已放行, 由 request 事件之觀察者記為違規', async function() {
        browser = await launchBrowser()
        let ctx = await browser.newContext()
        await cdn.routeBrowser(ctx)
        await ctx.route(/example\.invalid/, (route) => route.continue()) //後註冊: 先執行, 本處理器之中止被繞過
        let page = await ctx.newPage()
        await page.goto(site.url + '/')
        let r = await page.evaluate(async () => {
            try {
                await fetch('https://example.invalid/later.js', { mode: 'no-cors' })
                return 'ok'
            }
            catch (e) {
                return 'failed' //外部網址不可解析, 連線失敗(請求本身已放行出去)
            }
        })
        assert.strictEqual(r, 'failed')
        assert.throws(() => cdn.assertNoViolation(mark), (err) => JSON.stringify(uniq(err.violations)) === JSON.stringify(['https://example.invalid/later.js']))
    })

    it('[CE14] 啟動出口斷言「沒有漏接」: isRouted 對已掛者為 true、未掛者為 false(供使用端之啟動輔助或盤點測試使用)', async function() {
        browser = await launchBrowser()
        assert.strictEqual(cdn.isRouted(browser), false)
        let ctx0 = await browser.newContext()
        await cdn.routeBrowser(browser)
        assert.strictEqual(cdn.isRouted(browser), true)
        assert.strictEqual(cdn.isRouted(ctx0), true, '已存在之 context')
        let page = await browser.newPage()
        assert.strictEqual(cdn.isRouted(page), true, '其後建立之頁面')
        let other = await launchBrowser()
        try {
            assert.strictEqual(cdn.isRouted(other), false)
            let p2 = await other.newPage()
            assert.strictEqual(cdn.isRouted(p2), false)
        }
        finally {
            await other.close()
        }
    })

    it('[CE10] 與使用端自己之 route 並存: 先註冊之使用端 route 對放行之請求(回送位址)仍生效(fallback 串接), 清單內與清單外之處理不受影響', async function() {
        browser = await launchBrowser()
        let ctx = await browser.newContext()
        let mocked = 0
        await ctx.route(/\/mock-api$/, (route) => {
            mocked++
            return route.fulfill({ status: 200, contentType: 'text/plain', body: 'mocked-by-user' })
        })
        await cdn.routeBrowser(ctx) //之後註冊, 先於使用端 route 執行; 放行者 fallback 交給使用端 route
        let page = await ctx.newPage()
        await page.goto(site.url + '/')
        let r = await page.evaluate(async (base) => (await fetch(base + '/mock-api')).text(), site.url)
        assert.strictEqual(r, 'mocked-by-user')
        assert.strictEqual(mocked, 1)
        assert.strictEqual(site.hits['/mock-api'], undefined, '請求不得抵達伺服器')
        await page.evaluate((u) => new Promise((resolve, reject) => {
            let s = document.createElement('script')
            s.src = u
            s.onload = resolve
            s.onerror = reject
            document.head.appendChild(s)
        }), HOST + '/pkg-0@1.0.0/dist/f0.js')
        assert.strictEqual(await page.evaluate(() => window.__fx0), 'v0')
        cdn.assertNoViolation(mark)
    })

    //[CE15x] 清單內之網址被使用端自設之 route 放走(R-CL-12): 「真實來源」為回送位址之夾具伺服器(以 --host-resolver-rules 把 real.fixture.invalid 對應到 127.0.0.1,
    //  清單釘選之內容為 LOCAL, 真實來源供應 REAL, 故頁面讀到 REAL 即證明請求直達來源); 修前(只記清單外之請求)連網時測不出, 斷網才紅
    describe('清單內之網址被使用端 route 放走(R-CL-12)', function() {
        let origin = null
        let cdnR = null
        let libUrl = ''
        let markR = null
        let RE = /real\.fixture\.invalid/
        let LOCAL = Buffer.from(`window.__src='LOCAL'`)

        before(async function() {
            let hits = 0
            let server = http.createServer((req, res) => {
                hits++
                res.writeHead(200, { 'content-type': 'application/javascript' })
                res.end(`window.__src='REAL'`)
            })
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
            origin = {
                port: server.address().port,
                get hits() {
                    return hits
                },
                reset: () => {
                    hits = 0
                },
                close: () => new Promise((resolve) => {
                    server.closeAllConnections()
                    server.close(resolve)
                }),
            }
            libUrl = `http://real.fixture.invalid:${origin.port}/lib.js`
            cdnR = createCdnLocal({ manifest: { schema: 1, files: { [libUrl]: { sha256: sha(LOCAL), size: LOCAL.length } } }, cacheDir: path.join(fdTmp, `cache-${++n}`), fetch: async () => new Response(LOCAL), retryDelayMs: 10 })
            await cdnR.ensure()
        })

        beforeEach(function() {
            markR = cdnR.violationMark()
            origin.reset() //各案各自計真實來源之請求數
        })

        after(async function() {
            if (origin) {
                await origin.close()
            }
        })

        //開瀏覽器並建一個 context(尚未掛路由)
        let openCtx = async () => {
            browser = await launchBrowser({ args: ['--host-resolver-rules=MAP real.fixture.invalid 127.0.0.1'] })
            return await browser.newContext()
        }
        //等清單內之腳本之請求完成事件(須於載入前呼叫; 此監聽晚於 routeBrowser 掛上之觀察者, 故觀察者已先處理)
        let finishedOf = (ctx) => new Promise((resolve) => {
            let fn = (r) => {
                if (r.url() === libUrl) {
                    ctx.off('requestfinished', fn)
                    resolve()
                }
            }
            ctx.on('requestfinished', fn)
        })
        let loadLib = async (page) => {
            await page.setContent(`<!doctype html><script src="${libUrl}"></script><p>x</p>`, { waitUntil: 'load' })
            return await page.evaluate(() => window.__src)
        }

        it('[CE15a] 使用端於 routeBrowser 之後註冊之 route 對清單內之網址 continue(): 請求直達真實來源(頁面讀到 REAL), 觀察者於請求完成時記為違規(連網時亦測得出), 關閉時拋 E_CDN_EXTERNAL', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            await ctx.route(RE, (route) => route.continue())
            let page = await ctx.newPage()
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'REAL', '請求應已直達真實來源')
            await fin
            assert.ok(origin.hits >= 1, '真實來源應收到請求(預載掃描可能使同一網址被請求不只一次, 故不斷言恰一次)')
            assert.throws(() => cdnR.assertNoViolation(markR), (err) => err.code === 'E_CDN_EXTERNAL' && JSON.stringify(uniq(err.violations)) === JSON.stringify([libUrl]) && /未由本地副本供應/.test(err.violations[0].reason))
            await assert.rejects(() => ctx.close(), (err) => err.code === 'E_CDN_EXTERNAL')
        })

        it('[CE15b] 使用端之 route 於 routeBrowser 之後註冊但 fallback(): 交還本處理器, 由本地副本供應(讀到 LOCAL), 不連真實來源, 無違規', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            await ctx.route(RE, (route) => route.fallback())
            let page = await ctx.newPage()
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'LOCAL')
            await fin
            assert.strictEqual(origin.hits, 0)
            cdnR.assertNoViolation(markR)
            await ctx.close() //無違規不拋
        })

        it('[CE15c] 使用端之 route 於 routeBrowser 之前註冊(後註冊者先執行, 本處理器先於它): 即使其 continue() 亦不會被執行, 由本地副本供應, 無違規', async function() {
            let ctx = await openCtx()
            let userHits = 0
            await ctx.route(RE, (route) => {
                userHits++
                return route.continue()
            })
            await cdnR.routeBrowser(ctx)
            let page = await ctx.newPage()
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'LOCAL')
            await fin
            assert.strictEqual(origin.hits, 0)
            assert.strictEqual(userHits, 0, '本處理器已 fulfill, 先註冊之 route 看不到該請求')
            cdnR.assertNoViolation(markR)
            await ctx.close()
        })

        it('[CE15d] page 層之 route(優先於 context 層)對清單內之網址 continue(): 同樣直達來源, 觀察者記為違規', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            let page = await ctx.newPage()
            await page.route(RE, (route) => route.continue())
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'REAL')
            await fin
            assert.ok(origin.hits >= 1, '真實來源應收到請求')
            assert.throws(() => cdnR.assertNoViolation(markR), (err) => err.code === 'E_CDN_EXTERNAL' && JSON.stringify(uniq(err.violations)) === JSON.stringify([libUrl]))
            await assert.rejects(() => ctx.close(), (err) => err.code === 'E_CDN_EXTERNAL')
        })

        it('[CE15e] 使用端之 route 自行 fulfill 清單內之網址(內容不是本地副本): 同樣未由本地副本供應而記為違規(測試讀到之內容不是清單釘選者)', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            await ctx.route(RE, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.__src='OWN'` }))
            let page = await ctx.newPage()
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'OWN')
            await fin
            assert.strictEqual(origin.hits, 0)
            assert.throws(() => cdnR.assertNoViolation(markR), (err) => err.code === 'E_CDN_EXTERNAL' && JSON.stringify(uniq(err.violations)) === JSON.stringify([libUrl]))
            await assert.rejects(() => ctx.close(), (err) => err.code === 'E_CDN_EXTERNAL')
        })

        it('[CE15f] 對照: 無使用端 route 時由本地副本供應、不連真實來源、無違規(確認夾具之 host 對應有效且上列各案之差異來自 route)', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            let page = await ctx.newPage()
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'LOCAL')
            await fin
            assert.strictEqual(origin.hits, 0)
            cdnR.assertNoViolation(markR)
            await ctx.close()

            //夾具有效性: 不經任何路由時 real.fixture.invalid 確實對應到真實來源(讀到 REAL)
            let raw = await browser.newContext()
            let p2 = await raw.newPage()
            assert.strictEqual(await loadLib(p2), 'REAL')
            assert.ok(origin.hits >= 1, '不經路由之瀏覽器確實打到真實來源')
        })

        it('[CE15g] 使用端之故障模擬不誤報: route 對清單內之腳本 abort、或 fulfill HTTP 錯誤狀態(404、503)時, 腳本請求失敗(requestfailed, 非完成), 不記違規; 頁面確實載入失敗(未讀到任何來源之內容)', async function() {
            let cases = [
                ['abort', (route) => route.abort('connectionrefused')],
                ['fulfill 404', (route) => route.fulfill({ status: 404, body: 'not found' })],
                ['fulfill 503＋標頭', (route) => route.fulfill({ status: 503, body: 'down', headers: { 'x-fault': '1' } })],
            ]
            for (let [label, handler] of cases) {
                let ctx = await openCtx()
                await cdnR.routeBrowser(ctx)
                await ctx.route(RE, handler)
                let page = await ctx.newPage()
                let failed = new Promise((resolve) => {
                    let fn = (r) => {
                        if (r.url() === libUrl) {
                            ctx.off('requestfailed', fn)
                            resolve()
                        }
                    }
                    ctx.on('requestfailed', fn)
                })
                await page.setContent(`<!doctype html><script src="${libUrl}" onerror="window.__err=1"></script>`, { waitUntil: 'load' })
                await failed
                assert.strictEqual(await page.evaluate(() => [window.__src, window.__err]).then((r) => JSON.stringify(r)), JSON.stringify([null, 1]), label)
                assert.strictEqual(origin.hits, 0, label + ': 不連真實來源')
                cdnR.assertNoViolation(markR)
                await ctx.close() //無違規不拋
                await browser.close()
                browser = null
            }
        })

        it('[CE15i] 已知限制之釘住: 對 fetch()／XHR 發出之請求, 使用端之 route fulfill HTTP 錯誤狀態(404)時 Chromium 視為完成(非失敗), 依規則記為違規(故障模擬若走 fetch／XHR 須對該 describe 以 guard:false 暫不夾斷言)', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            await ctx.route(RE, (route) => route.fulfill({ status: 404, body: 'not found', headers: { 'access-control-allow-origin': '*' } }))
            let page = await ctx.newPage()
            await page.setContent('<p>x</p>')
            let r = await page.evaluate(async (u) => {
                let res = await fetch(u)
                let st = await new Promise((resolve) => {
                    let x = new XMLHttpRequest()
                    x.open('GET', u)
                    x.onload = () => resolve(x.status)
                    x.onerror = () => resolve('error')
                    x.send()
                })
                return [res.status, st]
            }, libUrl)
            assert.deepStrictEqual(r, [404, 404])
            //完成事件經 CDP 回送, 與頁面端 Promise 之解決無順序保證: 以輪詢可觀察條件(違規筆數)同步, 不以延時
            await waitUntil(() => cdnR.getViolations().length >= markR.n + 2, 10000, 'fetch 與 XHR 之完成事件')
            assert.throws(() => cdnR.assertNoViolation(markR), (err) => err.code === 'E_CDN_EXTERNAL' && JSON.stringify(uniq(err.violations)) === JSON.stringify([libUrl]))
            assert.strictEqual(origin.hits, 0, 'fulfill 之請求不連真實來源')
            await assert.rejects(() => ctx.close(), (err) => err.code === 'E_CDN_EXTERNAL')
        })

        it('[CE15h] 使用端之 route 以 route.fetch() 取得真實來源之內容後再 fulfill(轉供): 請求雖未以 continue() 放走, 仍直連來源, 頁面讀到之內容不是清單釘選者, 記為違規', async function() {
            let ctx = await openCtx()
            await cdnR.routeBrowser(ctx)
            await ctx.route(RE, async (route) => {
                let response = await route.fetch({ url: route.request().url().replace('real.fixture.invalid', '127.0.0.1') }) //route.fetch 由 Node 端連線, 不經瀏覽器之主機對應
                await route.fulfill({ response })
            })
            let page = await ctx.newPage()
            let fin = finishedOf(ctx)
            assert.strictEqual(await loadLib(page), 'REAL')
            await fin
            assert.ok(origin.hits >= 1)
            assert.throws(() => cdnR.assertNoViolation(markR), (err) => err.code === 'E_CDN_EXTERNAL' && JSON.stringify(uniq(err.violations)) === JSON.stringify([libUrl]))
            await assert.rejects(() => ctx.close(), (err) => err.code === 'E_CDN_EXTERNAL')
        })

    })

    it('[CE16] routeLaunch(R-CL-14)經真瀏覽器: 以啟動函數取得之瀏覽器已掛路由(isRouted), 其頁面載入清單內之腳本由本地副本供應, 清單外之請求中止並記違規', async function() {
        browser = await cdn.routeLaunch(() => launchBrowser())
        assert.strictEqual(cdn.isRouted(browser), true)
        let page = await browser.newPage()
        await page.setContent(`<script src="${HOST}/pkg-2@1.0.2/dist/f2.js"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await page.evaluate(() => window.__fx2), 'v2')
        cdn.assertNoViolation(mark)
        await page.setContent('<script src="https://example.invalid/x.js"></script>', { waitUntil: 'load' })
        assert.throws(() => cdn.assertNoViolation(mark), (err) => err.code === 'E_CDN_EXTERNAL')
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
    })

    it('[CE16b] README 橋接檔範本經真 w-playwright 接縫: wpw.setBrowserTypeForTest 之替身內以 routeLaunch(next) 取得瀏覽器, 其後 launchBrowser() 啟動者已掛路由並由本地副本供應; setBrowserTypeForTest 為「替換」(後設定之替身直呼 next() 者漏接, 還原後先前之替身重新生效)', async function() {
        let restore1 = wpw.setBrowserTypeForTest({ launch: (o, next) => cdn.routeLaunch(next) })
        try {
            browser = await launchBrowser()
            assert.strictEqual(cdn.isRouted(browser), true, '範本之替身應使 launchBrowser() 啟動者掛路由')
            let page = await browser.newPage()
            await page.setContent(`<script src="${HOST}/pkg-1@1.0.1/dist/f1.js"></script>`, { waitUntil: 'load' })
            assert.strictEqual(await page.evaluate(() => window.__fx1), 'v1', '由本地副本供應')
            cdn.assertNoViolation(mark)
            await browser.close()
            browser = null

            //替換而非疊放: 後設定之替身(堆疊頂)直呼 next() 直達真 BrowserType, 不經先設定之替身 → 漏接
            let restore2 = wpw.setBrowserTypeForTest({ launch: (o, next) => next() })
            try {
                browser = await launchBrowser()
                assert.strictEqual(cdn.isRouted(browser), false, '後設定之替身直呼 next() 不經先前之替身, 屬漏接')
                await browser.close()
                browser = null
            }
            finally {
                restore2()
            }

            //還原頂端之替身後, 先前之替身重新生效
            browser = await launchBrowser()
            assert.strictEqual(cdn.isRouted(browser), true)
        }
        finally {
            restore1()
        }
    })

    it('[CE16c] README 首選寫法 wpw.onBrowserCreated((t) => cdn.routeBrowser(t)) 經真 w-playwright(排程第 636 項 ⑤): launchBrowser() 啟動者已掛路由並由本地副本供應; 自設之 setBrowserTypeForTest 替身直呼 next() 亦生效(鉤子與替身正交, 不同於 [CE16b] 之替換漏接); 持久入口之 BrowserContext 亦然; restore() 後不再掛', async function() {
        let restoreHook = wpw.onBrowserCreated((t) => cdn.routeBrowser(t))
        hookRestore = restoreHook
        try {
            //1. 無替身: launchBrowser() 啟動者已掛路由, 頁面由本地副本供應
            browser = await launchBrowser()
            assert.strictEqual(cdn.isRouted(browser), true, '鉤子應使 launchBrowser() 啟動者掛路由')
            let page = await browser.newPage()
            await page.setContent(`<script src="${HOST}/pkg-1@1.0.1/dist/f1.js"></script>`, { waitUntil: 'load' })
            assert.strictEqual(await page.evaluate(() => window.__fx1), 'v1', '由本地副本供應')
            cdn.assertNoViolation(mark)
            await page.setContent('<script src="https://example.invalid/x.js"></script>', { waitUntil: 'load' })
            assert.throws(() => cdn.assertNoViolation(mark), (err) => err.code === 'E_CDN_EXTERNAL', '清單外之請求中止並記違規')
            let bro = browser
            browser = null
            await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')

            //2. 使用端自設之替身直呼 next()(不經 routeLaunch): 鉤子套在最終回傳者上, 仍生效(正交; [CE16b] 之 routeLaunch 範本在此情形漏接)
            let mark2 = cdn.violationMark()
            let restoreFake = wpw.setBrowserTypeForTest({ launch: (o, next) => next() })
            try {
                browser = await launchBrowser()
                assert.strictEqual(cdn.isRouted(browser), true, '自設替身直呼 next() 亦應掛路由')
                let p2 = await browser.newPage()
                await p2.setContent(`<script src="${HOST}/pkg-2@1.0.2/dist/f2.js"></script>`, { waitUntil: 'load' })
                assert.strictEqual(await p2.evaluate(() => window.__fx2), 'v2')
                cdn.assertNoViolation(mark2)
                await browser.close()
                browser = null
            }
            finally {
                restoreFake()
            }

            //3. 持久入口: 鉤子之 target 為持久 BrowserContext(routeBrowser 接受 context)
            let persistent = await wpw.launchChromiumPersistent('', { headless: true })
            try {
                assert.strictEqual(cdn.isRouted(persistent), true, '持久入口之 BrowserContext 應掛路由')
                let p3 = await persistent.newPage()
                await p3.setContent(`<script src="${HOST}/pkg-3@1.0.3/dist/f3.js"></script>`, { waitUntil: 'load' })
                assert.strictEqual(await p3.evaluate(() => window.__fx3), 'v3')
            }
            finally {
                await persistent.close().catch(() => {})
            }
        }
        finally {
            restoreHook()
        }

        //4. restore() 後不再掛(重複呼叫無作用)
        restoreHook()
        browser = await launchBrowser()
        assert.strictEqual(cdn.isRouted(browser), false, '還原後啟動者不再經鉤子掛路由')
    })

    it('[CE17] opt.sources 與 opt.stubs(R-CL-13)經真瀏覽器: 本機檔來源之腳本(校驗後)由本地副本供應並執行、空腳本載入成功(onload)且不連網; 未列之未釘版網址仍中止並記違規', async function() {
        let local = path.join(fdTmp, 'local-lib.js')
        let body = fx.bodies['/pkg-0@1.0.0/dist/f0.js']
        fs.writeFileSync(local, body)
        let u = HOST + '/pkg-0@1.0.0/dist/f0.js'
        let stub = HOST + '/unpinned/lib.js'
        let other = HOST + '/unpinned/other.js'
        let fetched = []
        let c = createCdnLocal({
            manifest: { schema: 1, files: { [u]: fx.manifest.files[u] } },
            cacheDir: path.join(fdTmp, `cache-${++n}`),
            sources: { [u]: local },
            stubs: [stub],
            fetch: async (x) => {
                fetched.push(String(x))
                throw new Error('不得連網')
            },
        })
        await c.ensure()
        assert.deepStrictEqual(fetched, [], '本機來源與空腳本不連網')
        assert.deepStrictEqual([c.stats().files, c.stats().sourced, c.stats().stubs, c.stats().downloaded], [2, 2, 1, 0])
        await open(c)
        let page = await browser.newPage()
        await page.setContent(`<script src="${u}"></script><script src="${stub}" onload="window.__stub='loaded'" onerror="window.__stub='error'"></script><script src="${other}" onerror="window.__other='error'"></script>`, { waitUntil: 'load' })
        assert.strictEqual(await page.evaluate(() => window.__fx0), 'v0', '本機檔來源之腳本已執行')
        assert.strictEqual(await page.evaluate(() => window.__stub), 'loaded', '空腳本載入成功(200、JS 內容類型、0 位元組)')
        assert.strictEqual(await page.evaluate(() => window.__other), 'error', '未列之未釘版網址被中止')
        assert.throws(() => c.assertNoViolation(), (err) => JSON.stringify(uniq(err.violations)) === JSON.stringify([other]))
        let bro = browser
        browser = null
        await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')
    })

    it('[CE18] opt.loopbackPorts(R-CL-15)經真瀏覽器: 只放行列入之回送埠(頁面所在之站台)——同為回送位址而埠不同之站台 fetch 與 ws 皆被中止並記違規, 列入該 ws 之埠後放行', async function() {
        let site2 = await startSite()
        let ws = await startWsServer()
        try {
            let sitePort = Number(new URL(site.url).port)
            let wsPort = Number(new URL(ws.url).port)
            let c = createCdnLocal({ manifest: all, cacheDir: cdn.cacheDir, loopbackPorts: [sitePort] })
            await c.ensure()
            await open(c)
            let page = await browser.newPage()
            await page.goto(site.url + '/')
            assert.strictEqual(await page.evaluate(() => window.__own), 'own-loaded', '列入之埠(頁面所在之站台)放行')
            let r = await page.evaluate(async (u) => {
                try {
                    await fetch(u, { mode: 'no-cors' })
                    return 'ok'
                }
                catch (e) {
                    return 'blocked'
                }
            }, site2.url + '/api')
            assert.strictEqual(r, 'blocked', '同為回送位址而埠不同之站台應被中止')
            assert.strictEqual(site2.hits['/api'], undefined, '請求不得抵達該站台')
            let closed = await page.evaluate((u) => new Promise((resolve) => {
                let s = new WebSocket(u)
                s.onmessage = (e) => resolve('msg:' + e.data)
                s.onclose = (e) => resolve('closed:' + e.code)
            }), ws.url)
            assert.ok(/^closed:/.test(closed), '未列入埠之 ws 應被關閉: ' + closed)
            assert.strictEqual(ws.hits, 0)
            assert.throws(() => c.assertNoViolation(), (err) => err.violations.some((v) => v.kind === 'browser' && v.url === site2.url + '/api') && err.violations.some((v) => v.kind === 'websocket'))
            let bro = browser
            browser = null
            await assert.rejects(() => bro.close(), (err) => err.code === 'E_CDN_EXTERNAL')

            //列入 ws 之埠後放行
            let c2 = createCdnLocal({ manifest: all, cacheDir: cdn.cacheDir, loopbackPorts: [sitePort, wsPort] })
            await c2.ensure()
            await open(c2)
            let p2 = await browser.newPage()
            await p2.goto(site.url + '/')
            let msg = await p2.evaluate((u) => new Promise((resolve) => {
                let s = new WebSocket(u)
                s.onmessage = (e) => resolve('msg:' + e.data)
                s.onclose = (e) => resolve('closed:' + e.code)
            }), ws.url)
            assert.strictEqual(msg, 'msg:hello')
            c2.assertNoViolation()
        }
        finally {
            await site2.close()
            await ws.close()
        }
    })

})
