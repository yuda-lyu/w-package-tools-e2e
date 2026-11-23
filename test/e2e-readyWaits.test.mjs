import fs from 'fs'
import path from 'path'
import http from 'http'
import assert from 'assert'
import { pathToFileURL } from 'url'
import sharp from 'sharp'
import launchBrowser from '../src/launchBrowser.mjs'
import captureStable from '../src/captureStable.mjs'
import captureStableWithBox from '../src/captureStableWithBox.mjs'
import waitStyleSheets from '../src/waitStyleSheets.mjs'
import waitScrollIdle from '../src/waitScrollIdle.mjs'


//截圖就緒條件(真 Chromium):
//排程第 529 項: 截圖前等 <link rel=stylesheet> 載入(高負載下曾截到 CSS 未載入之素頁)
//排程第 504 項: captureStableWithBox 捲入前先等進行中之捲動結束(scrollIntoViewIfNeeded 會截斷平滑捲動)
//夾具: 本機 HTTP 服務(作業系統配發之埠), 頁面與樣式表同源; 樣式表可延遲、暫扣(由測試放行)、404


const CSS_OK = '#b{background:rgb(200,0,0);width:200px;height:60px;border:0;margin:0;padding:0;display:block}body{margin:8px}'


//讀 PNG 某點之 RGB
async function pixelAt(buf, x, y) {
    let { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    let i = (y * info.width + x) * info.channels
    return [data[i], data[i + 1], data[i + 2]]
}


//紅框(#f26 = 255,34,102)像素之外接矩形
async function redBounds(buf) {
    let { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    let b = null
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            let i = (y * info.width + x) * info.channels
            if (data[i] > 230 && data[i + 1] < 70 && data[i + 2] > 80 && data[i + 2] < 130) {
                if (!b) {
                    b = { left: x, top: y, right: x, bottom: y }
                }
                else {
                    b.left = Math.min(b.left, x)
                    b.top = Math.min(b.top, y)
                    b.right = Math.max(b.right, x)
                    b.bottom = Math.max(b.bottom, y)
                }
            }
        }
    }
    return b
}


describe('截圖就緒: 樣式表載入(排程第 529 項)', function() {
    this.timeout(120000)

    let srv = null
    let base = ''
    let held = [] //暫扣之回應
    let delayMs = 0
    before(async function() {
        srv = http.createServer((req, res) => {
            let u = new URL(req.url, 'http://x')
            if (u.pathname === '/slow.css') {
                setTimeout(() => {
                    res.writeHead(200, { 'content-type': 'text/css' })
                    res.end(CSS_OK)
                }, delayMs)
                return
            }
            if (u.pathname === '/held.css') {
                held.push(res)
                return
            }
            if (u.pathname === '/reset.css') {
                req.socket.destroy()
                return
            }
            if (u.pathname === '/404.css') {
                res.writeHead(404, { 'content-type': 'text/plain' })
                res.end('nf')
                return
            }
            if (u.pathname === '/ok.css') {
                res.writeHead(200, { 'content-type': 'text/css' })
                res.end(CSS_OK)
                return
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end('<!doctype html><html><head></head><body><button id="b">btn</button></body></html>')
        })
        await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
        base = `http://127.0.0.1:${srv.address().port}`
    })
    after(async function() {
        held.forEach((r) => r.destroy())
        await new Promise((resolve) => srv.close(resolve))
    })

    let browser = null
    let page = null
    beforeEach(async function() {
        browser = await launchBrowser()
        page = await (await browser.newContext({ viewport: { width: 400, height: 200 } })).newPage()
        await page.goto(`${base}/`)
    })
    afterEach(async function() {
        held.splice(0).forEach((r) => {
            r.writeHead(200, { 'content-type': 'text/css' })
            r.end(CSS_OK)
        })
        await browser.close()
    })

    //動態插入樣式表(非同步 chunk 之 CSS 即如此; 不阻擋首次繪製)
    let addLink = (href) => page.evaluate((h) => {
        let l = document.createElement('link')
        l.rel = 'stylesheet'
        l.href = h
        document.head.appendChild(l)
    }, href)

    it('[RS-01] 樣式表延遲 1.5 秒(負載高): captureStable 等其載入後才截, 截到套用 CSS 之畫面(按鈕 200,0,0)——不經任何替身', async function() {
        delayMs = 1500
        await addLink('/slow.css')
        let buf = await captureStable(page, { initialWaitMs: 0, strict: false })
        assert.strict.deepStrictEqual(await pixelAt(buf, 190, 60), [200, 0, 0], '截圖應已套用樣式表(未等則為瀏覽器預設之小按鈕, 該點為白底)')
    })

    it('[RS-02] 樣式表延遲時 captureStableWithBox 之紅框量的是套用 CSS 後之版面(框住 200x60 之按鈕)', async function() {
        delayMs = 1500
        await addLink('/slow.css')
        let buf = await captureStableWithBox(page, '#b', { initialWaitMs: 0, strict: false })
        let b = await redBounds(buf)
        //按鈕 x 8..208、y 8..68; 框外擴 6 → 約 2..214、2..74(夾邊留距與描邊另計, 只驗涵蓋)
        assert.strict.ok(b && b.right >= 208 && b.bottom >= 68, `紅框應涵蓋套用 CSS 後之按鈕(實得 ${JSON.stringify(b)})`)
    })

    it('[RS-03] 暫扣之樣式表於等待中放行: 進入等待後才放行亦截到套用後之畫面(以事件同步: 包住等待函數, 進入時放行)', async function() {
        await addLink('/held.css')
        let entered = 0
        let buf = await captureStable(page, {
            initialWaitMs: 0,
            strict: false,
            waitStylesFn: async (p, o) => {
                entered++
                let pr = waitStyleSheets(p, o)
                held.splice(0).forEach((r) => {
                    r.writeHead(200, { 'content-type': 'text/css' })
                    r.end(CSS_OK)
                })
                return pr
            },
        })
        assert.strict.equal(entered, 1)
        assert.strict.deepStrictEqual(await pixelAt(buf, 190, 60), [200, 0, 0])
    })

    it('[RS-04] 逾時仍載入中: strict 拋錯(含 href 與「逾時 Nms 仍載入中」); 非 strict 印 [style-not-ready] 後回傳', async function() {
        await addLink('/held.css')
        await assert.rejects(captureStable(page, { initialWaitMs: 0, strict: true, styleTimeoutMs: 300 }), (err) => {
            assert.strict.match(err.message, /樣式表未就緒\(逾時 300ms 仍載入中 1 個: http:\/\/127\.0\.0\.1:\d+\/held\.css; 載入失敗 0 個\)/)
            assert.strict.match(err.message, /regen 拒絕寫入樣式表未載入之畫面/)
            return true
        })
        let warns = []
        let orig = console.warn
        console.warn = (s) => warns.push(String(s))
        try {
            let buf = await captureStable(page, { initialWaitMs: 0, strict: false, styleTimeoutMs: 300 })
            assert.strict.ok(Buffer.isBuffer(buf))
        }
        finally {
            console.warn = orig
        }
        assert.strict.ok(warns.some((s) => s.startsWith('[style-not-ready]') && s.includes('held.css')), warns.join('|'))
        //captureStableWithBox: 量框前亦告警(框可能依未套用樣式表之版面)
        let warns2 = []
        console.warn = (s) => warns2.push(String(s))
        try {
            await captureStableWithBox(page, '#b', { initialWaitMs: 0, strict: false, styleTimeoutMs: 300 })
        }
        finally {
            console.warn = orig
        }
        assert.strict.ok(warns2.some((s) => s.startsWith('[style-not-ready] captureStableWithBox 量框前')), warns2.join('|'))
    })

    it('[RS-05] 同源載入失敗(404): strict 拋錯(載入失敗 1 個); 非 strict 告警後回傳; 不等待逾時', async function() {
        await addLink('/404.css')
        await page.waitForFunction(() => Array.from(document.querySelectorAll('link')).every((l) => l.sheet))
        let t0 = Date.now()
        let r = await waitStyleSheets(page, { timeout: 20000 })
        assert.strict.ok(Date.now() - t0 < 10000, '載入失敗者已結束, 不應等到逾時')
        assert.strict.deepStrictEqual([r.pending.length, r.failed.length], [0, 1])
        await assert.rejects(captureStable(page, { initialWaitMs: 0, strict: true }), /載入失敗 1 個: http:\/\/127\.0\.0\.1:\d+\/404\.css/)
        //連線重設(responseStatus 0)亦為失敗
        await addLink('/reset.css')
        await page.waitForFunction(() => Array.from(document.querySelectorAll('link')).every((l) => l.sheet))
        let r2 = await waitStyleSheets(page, { timeout: 20000 })
        assert.strict.deepStrictEqual([r2.pending.length, r2.failed.map((h) => h.replace(/^.*\//, ''))], [0, ['404.css', 'reset.css']])
    })

    it('[RS-12] 訊息中之網址經遮罩(查詢秘密值不外露); 注入函數非函數時視為未給(K3, 不拋 TypeError)', async function() {
        await addLink('/held.css?token=SECRET123&v=1')
        await assert.rejects(captureStable(page, { initialWaitMs: 0, strict: true, styleTimeoutMs: 300 }), (err) => {
            assert.strict.ok(!err.message.includes('SECRET123'), err.message)
            assert.strict.match(err.message, /held\.css\?token=\*\*\*&v=1/)
            return true
        })
        //waitStylesFn 非函數 → 用預設(仍等樣式表並依 strict 拋錯, 而非 TypeError)
        await assert.rejects(captureStable(page, { initialWaitMs: 0, strict: true, styleTimeoutMs: 300, waitStylesFn: 'x' }), /樣式表未就緒/)
    })

    it('[RS-06] 已載入、無樣式表、跨來源無從判定者: 不等待、不告警(正常頁面行為不變, 開與關之截圖逐位元相同); 跨來源 404 不判為失敗', async function() {
        await addLink('/ok.css')
        await page.waitForFunction(() => Array.from(document.querySelectorAll('link')).every((l) => l.sheet))
        let r1 = await waitStyleSheets(page)
        assert.strict.deepStrictEqual([r1.pending, r1.failed], [[], []])
        let warns = []
        let orig = console.warn
        console.warn = (s) => warns.push(String(s))
        try {
            let on = await captureStable(page, { initialWaitMs: 0, strict: true })
            let off = await captureStable(page, { initialWaitMs: 0, strict: true, waitStyles: false })
            assert.strict.ok(on.equals(off), '已載入之頁面: waitStyles 開與關之截圖應逐位元相同')
        }
        finally {
            console.warn = orig
        }
        assert.strict.deepStrictEqual(warns, [])
        let p2 = await (await browser.newContext()).newPage()
        await p2.setContent('<p>x</p>')
        assert.strict.deepStrictEqual((await waitStyleSheets(p2)).pending, [])
        //跨來源: about:blank(setContent)之 origin 與服務不同
        await p2.setContent(`<link rel="stylesheet" href="${base}/404.css" onerror="window.__cssErr=1"><p>x</p>`)
        await p2.waitForFunction(() => Array.from(document.querySelectorAll('link')).every((l) => l.sheet))
        //前提: 該跨來源樣式表確為載入失敗(否則本案無鑑別力)
        assert.strict.equal(await p2.evaluate(() => window.__cssErr), 1)
        let r3 = await waitStyleSheets(p2)
        assert.strict.deepStrictEqual([r3.pending, r3.failed], [[], []])
    })

    it('[RS-07] waitStyles:false 為改版前之行為: 不等樣式表, 截到未套用 CSS 之畫面(修前形狀之對照)', async function() {
        await addLink('/held.css')
        let buf = await captureStable(page, { initialWaitMs: 0, strict: false, waitStyles: false })
        assert.strict.notDeepStrictEqual(await pixelAt(buf, 190, 60), [200, 0, 0])
    })

    it('[RS-09] 跨來源(他埠)載入成功而 responseStatus 為 0(無 Timing-Allow-Origin)者不判為失敗', async function() {
        let srv2 = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'text/css' })
            res.end(CSS_OK)
        })
        await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve))
        try {
            let href = `http://127.0.0.1:${srv2.address().port}/x.css`
            await addLink(href)
            await page.waitForFunction(() => Array.from(document.querySelectorAll('link')).every((l) => l.sheet))
            //前提: 已載入且 Resource Timing 有紀錄而 responseStatus 為 0(若誤判跨來源即判為失敗)
            assert.strict.deepStrictEqual(await page.evaluate((h) => performance.getEntriesByName(h, 'resource').map((e) => e.responseStatus), href), [0])
            assert.strict.deepStrictEqual(await pixelAt(await page.screenshot(), 190, 60), [200, 0, 0])
            let r = await waitStyleSheets(page)
            assert.strict.deepStrictEqual([r.pending, r.failed], [[], []])
        }
        finally {
            await new Promise((resolve) => srv2.close(resolve))
        }
    })

    it('[RS-10] file: 頁面之樣式表不判為失敗、不等待', async function() {
        let fd = path.resolve('./test/_tmp/readyWaits')
        fs.mkdirSync(fd, { recursive: true })
        try {
            fs.writeFileSync(path.join(fd, 'ok.css'), CSS_OK)
            fs.writeFileSync(path.join(fd, 'p.html'), '<!doctype html><html><head><link rel="stylesheet" href="ok.css"></head><body><button id="b">btn</button></body></html>')
            await page.goto(pathToFileURL(path.join(fd, 'p.html')).href)
            //前提: 已套用(Chromium 159 實測 file: 資源無 Resource Timing 紀錄, 故 waitStyleSheets 之 http(s) 限定於此為防禦性, 本案只驗不誤判)
            assert.strict.deepStrictEqual(await pixelAt(await page.screenshot(), 190, 60), [200, 0, 0])
            let r = await waitStyleSheets(page)
            assert.strict.deepStrictEqual([r.pending, r.failed], [[], []])
        }
        finally {
            fs.rmSync(fd, { recursive: true, force: true })
            let fdParent = path.dirname(fd)
            if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
                fs.rmdirSync(fdParent)
            }
        }
    })

    it('[RS-11] sheet 留為 null 之失敗(SRI 不符): 不等到逾時, 判為失敗(等待前已失敗、等待中才失敗兩種)', async function() {
        //等待前已失敗: 靜態插入並等其 error
        await page.evaluate(() => new Promise((resolve) => {
            let l = document.createElement('link')
            l.rel = 'stylesheet'
            l.href = '/ok.css?sri1'
            l.integrity = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
            l.addEventListener('error', () => resolve())
            document.head.appendChild(l)
        }))
        //前提: 失敗後 sheet 仍為 null(否則本案與 [RS-05] 同, 無鑑別力)
        assert.strict.equal(await page.evaluate(() => document.querySelector('link[href$="sri1"]').sheet), null)
        let t0 = Date.now()
        let r = await waitStyleSheets(page, { timeout: 20000 })
        assert.strict.ok(Date.now() - t0 < 10000, `不應等到逾時(${Date.now() - t0}ms)`)
        assert.strict.deepStrictEqual([r.pending.length, r.failed.length], [0, 1])
        //等待中才失敗: 暫扣之回應放行後 SRI 不符
        await page.evaluate(() => {
            let l = document.createElement('link')
            l.rel = 'stylesheet'
            l.href = '/held.css?sri2'
            l.integrity = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
            document.head.appendChild(l)
        })
        let r2 = await captureStable(page, {
            initialWaitMs: 0,
            strict: false,
            waitStylesFn: async (p, o) => {
                let pr = waitStyleSheets(p, o)
                await new Promise((resolve) => setTimeout(resolve, 300))
                held.splice(0).forEach((x) => {
                    x.writeHead(200, { 'content-type': 'text/css' })
                    x.end(CSS_OK)
                })
                let v = await pr
                assert.strict.deepStrictEqual([v.pending.length, v.failed.length], [0, 2])
                return { pending: [], failed: [] }
            },
        })
        assert.strict.ok(Buffer.isBuffer(r2))
    })

    it('[RS-08] disabled、rel=alternate stylesheet、無 href 之 link 不納入等待', async function() {
        await page.evaluate((b) => {
            for (let [rel, dis, href] of [['stylesheet', true, `${b}/held.css?d`], ['alternate stylesheet', false, `${b}/held.css?a`], ['stylesheet', false, '']]) {
                let l = document.createElement('link')
                l.rel = rel
                if (href) {
                    l.href = href
                }
                l.disabled = dis
                document.head.appendChild(l)
            }
        }, base)
        let r = await waitStyleSheets(page, { timeout: 300 })
        assert.strict.deepStrictEqual([r.pending, r.failed], [[], []])
    })

})


describe('截圖就緒: 捲入前等進行中之捲動結束(排程第 504 項)', function() {
    this.timeout(120000)

    //Chromium 159 之 headless 預設無平滑捲動動畫(programmatic smooth 即時完成); --enable-smooth-scrolling 重現使用端於 Chromium 156 所見之動畫
    let PAGE = '<div class="sb" style="height:300px;overflow-y:auto;border:0"><div style="height:600px">top</div><form id="f" style="height:400px;background:#ddd">form</form></div>'
    let browser = null
    let page = null
    afterEach(async function() {
        if (browser) {
            await browser.close()
            browser = null
        }
    })
    let open = async (args) => {
        browser = await launchBrowser({ args })
        page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage()
        await page.setContent(PAGE)
    }
    let smooth = () => page.evaluate(() => {
        document.querySelector('.sb').scrollTop = 0
        document.querySelector('#f').scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    let top = () => page.evaluate(() => document.querySelector('.sb').scrollTop)

    it('[SI-01] 平滑捲動進行中呼叫 captureStableWithBox(目標為完整可見之捲動容器): 動畫跑完, scrollTop 停在終點 600(修前被截斷於中途)', async function() {
        await open(['--enable-smooth-scrolling'])
        await smooth()
        let mid = await top()
        assert.strict.ok(mid < 600, `前提: 呼叫時動畫進行中(scrollTop=${mid})`)
        await captureStableWithBox(page, '.sb', { initialWaitMs: 0, strict: false })
        assert.strict.equal(await top(), 600)
    })

    it('[SI-02] waitScrollIdle:false 為改版前之行為: 平滑捲動被截斷(scrollTop 停在 600 以前; 修前形狀之對照)', async function() {
        await open(['--enable-smooth-scrolling'])
        await smooth()
        await captureStableWithBox(page, '.sb', { initialWaitMs: 0, strict: false, waitScrollIdle: false })
        let t = await top()
        await page.waitForTimeout(1000)
        assert.strict.equal(await top(), t, '截斷後不再前進')
        assert.strict.ok(t < 600, `應被截斷於中途(實得 ${t})`)
    })

    it('[SI-03] 預設啟動(無平滑捲動動畫)與無捲動進行時: waitScrollIdle 於數個影格內回 idle, scrollTop 與量框結果不變', async function() {
        await open([])
        await smooth()
        let r = await waitScrollIdle(page)
        assert.strict.ok(r.idle === true && r.frames >= 3 && r.waitedMs < 1000, JSON.stringify(r))
        let b1 = await captureStableWithBox(page, '#f', { initialWaitMs: 0, strict: true })
        let b2 = await captureStableWithBox(page, '#f', { initialWaitMs: 0, strict: true, waitScrollIdle: false })
        assert.strict.equal(await top(), 600)
        assert.strict.ok(await redBounds(b1), '前提: 有紅框')
        assert.strict.ok(b1.equals(b2), '無捲動進行時, 開與關之截圖(含紅框)逐位元相同')
    })

    it('[SI-04] 持續捲動(跑馬燈)時 waitScrollIdle 逾時回 idle:false 且計得 scroll 事件; captureStableWithBox 印 [box-scroll-busy] 後照常完成', async function() {
        await open([])
        await page.evaluate(() => {
            let sb = document.querySelector('.sb')
            let d = 1
            let step = () => {
                sb.scrollTop += d
                if (sb.scrollTop >= 650 || sb.scrollTop <= 0) {
                    d = -d
                }
                requestAnimationFrame(step)
            }
            requestAnimationFrame(step)
        })
        let r = await waitScrollIdle(page, { timeout: 400 })
        assert.strict.ok(r.idle === false && r.scrolls > 0, JSON.stringify(r))
        let warns = []
        let orig = console.warn
        console.warn = (s) => warns.push(String(s))
        try {
            await captureStableWithBox(page, '.sb', { initialWaitMs: 0, strict: false, scrollIdleTimeoutMs: 400, maxRetries: 1 })
        }
        finally {
            console.warn = orig
        }
        assert.strict.ok(warns.some((s) => s.startsWith('[box-scroll-busy]')), warns.join('|'))
    })

    it('[SI-05] 第一個目標為矩形(不捲入)時不等捲動(不呼叫 waitScrollIdleFn)', async function() {
        await open([])
        let called = 0
        let fakeIdle = async () => {
            called++
            return { idle: true }
        }
        await captureStableWithBox(page, { x: 10, y: 10, width: 100, height: 50 }, { initialWaitMs: 0, strict: false, waitScrollIdleFn: fakeIdle })
        assert.strict.equal(called, 0)
        await captureStableWithBox(page, '.sb', { initialWaitMs: 0, strict: false, waitScrollIdleFn: fakeIdle })
        assert.strict.equal(called, 1)
        //非函數 → 用預設(K3, 不拋 TypeError)
        assert.strict.ok(Buffer.isBuffer(await captureStableWithBox(page, '.sb', { initialWaitMs: 0, strict: false, waitScrollIdleFn: null })))
    })

})
