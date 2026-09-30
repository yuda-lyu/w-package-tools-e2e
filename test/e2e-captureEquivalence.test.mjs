import assert from 'assert'
import sharp from 'sharp'
import launchBrowser from '../src/launchBrowser.mjs'
import captureStable from '../src/captureStable.mjs'
import captureStableWithBox from '../src/captureStableWithBox.mjs'
import gridContentBox from '../src/gridContentBox.mjs'
import itemsUnionBox from '../src/itemsUnionBox.mjs'
import canvasInkRects from '../src/canvasInkRects.mjs'
import waitAlertGone from '../src/waitAlertGone.mjs'
import inkRect from '../src/inkRect.mjs'
import waitColResizeOverlay from '../src/waitColResizeOverlay.mjs'
import waitDrawerReady from '../src/waitDrawerReady.mjs'
import resetAgGridScroll from '../src/resetAgGridScroll.mjs'


//截圖管線之行為等價驗證(真實 Chromium + page.setContent, 無伺服器):
//同一頁面同一狀態下, 以「各專案現行實作之凍結複本」與「套件以選項重現之」各截一次, 輸出須逐位元相同.
//凍結複本逐字取自 w-web-sso test/tools/e2e-setup.mjs(2026-09-27 版)與 w-web-perm test/tools/e2e-setup.mjs, 僅改為區域函數與改名


//凍結複本須與來源逐字相同(行為等價之對照組), 故此區不套本專案排版規則
/* eslint-disable brace-style, promise/param-names, object-property-newline */

//—— w-web-sso 凍結複本 (e2e-setup.mjs:343-354, 358-478, 484-498, 512-581, 588-619) ——
async function ssoWaitDrawerReady(page) {
    await page.waitForFunction(() => {
        let drawerStates = Array.from(document.querySelectorAll('[state]'))
            .map((e) => e.getAttribute('state'))
            .filter((s) => ['hidden', 'opening', 'opened', 'hiding'].includes(s))
        if (drawerStates.length === 0) {
            return true
        }
        return drawerStates.every((s) => s === 'opened' || s === 'hidden')
    }, null, { timeout: 10000, polling: 100 }).catch(() => {})
}
async function ssoMaskRegions(buf, rects, color = { r: 0, g: 0, b: 0 }) {
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let composite = rects
        .filter((r) => r.w > 0 && r.h > 0)
        .map((r) => {
            let left = Math.max(0, Math.round(r.x))
            let top = Math.max(0, Math.round(r.y))
            let width = Math.min(Math.round(r.w), imgW - left)
            let height = Math.min(Math.round(r.h), imgH - top)
            return { left, top, width, height }
        })
        .filter((c) => c.width > 0 && c.height > 0 && c.left < imgW && c.top < imgH)
        .map((c) => ({
            input: { create: { width: c.width, height: c.height, channels: 3, background: color } },
            left: c.left,
            top: c.top,
        }))
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}
async function ssoCaptureStable(page, opts = {}) {
    let { maxRetries = 8, intervalMs = 200, initialWaitMs = 1500, strict = (process.env.E2E_STRICT_CAPTURE === '1') } = opts
    let shotOpts = { fullPage: true, animations: 'disabled' }
    await page.mouse.move(0, 0)
    await page.waitForTimeout(initialWaitMs)
    await page.evaluate(async () => {
        let deadline = Date.now() + 5000
        while (Date.now() < deadline) {
            let bars = Array.from(document.querySelectorAll('[style*="cursor:col-resize"], [style*="cursor: col-resize"]'))
            if (bars.length === 0) return
            let allReady = bars.every(b => parseFloat(getComputedStyle(b).opacity) === 1)
            if (allReady) return
            await new Promise(r => setTimeout(r, 50))
        }
    })
    await ssoWaitDrawerReady(page)
    await page.evaluate(() => {
        document.querySelectorAll('svg').forEach((svg) => {
            if (typeof svg.pauseAnimations === 'function') {
                svg.pauseAnimations()
                if (typeof svg.setCurrentTime === 'function') {
                    svg.setCurrentTime(0)
                }
            }
        })
    })
    await page.evaluate(() => {
        return document.fonts && typeof document.fonts.ready?.then === 'function' ? document.fonts.ready : Promise.resolve()
    })
    let animatedRects = await page.evaluate(() => {
        let rects = []
        document.querySelectorAll('img').forEach((img) => {
            let src = img.src || ''
            if (!src.startsWith('data:image/svg+xml')) return
            let decoded = ''
            try {
                if (src.startsWith('data:image/svg+xml;base64,')) {
                    decoded = atob(src.slice('data:image/svg+xml;base64,'.length))
                }
                else {
                    decoded = decodeURIComponent(src)
                }
            }
            catch (err) {
                decoded = ''
            }
            if (/<animate/i.test(decoded)) {
                let r = img.getBoundingClientRect()
                rects.push({ x: r.left, y: r.top, w: r.width, h: r.height })
            }
        })
        return rects
    })
    let prev = await page.screenshot(shotOpts)
    if (animatedRects.length > 0) prev = await ssoMaskRegions(prev, animatedRects)
    for (let i = 0; i < maxRetries; i++) {
        await page.waitForTimeout(intervalMs)
        let curr = await page.screenshot(shotOpts)
        if (animatedRects.length > 0) curr = await ssoMaskRegions(curr, animatedRects)
        if (curr.equals(prev)) {
            return curr
        }
        prev = curr
    }
    if (strict) {
        throw new Error(`captureStable ${maxRetries} 次仍未 settle (regen 拒絕寫入未穩定畫面)`)
    }
    return prev
}
async function ssoComposeBox(buf, box) {
    let meta = await sharp(buf).metadata()
    let M = 3
    let bl = Math.max(M, box.left - 6)
    let bt = Math.max(M, box.top - 6)
    let br = Math.min(meta.width - M, box.right + 6)
    let bb = Math.min(meta.height - M, box.bottom + 6)
    if (br - bl <= 5 || bb - bt <= 5) {
        return buf
    }
    let svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${bl + 2.5}" y="${bt + 2.5}" width="${br - bl - 5}" height="${bb - bt - 5}" fill="none" stroke="#f26" stroke-width="5" rx="4" ry="4"/>` +
        `</svg>`
    return await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
}
async function ssoCaptureStableWithBox(page, target, opts = {}) {
    let { mask = [] } = opts
    let items = Array.isArray(target) ? target : [target]
    let isLoc = (x) => x && typeof x === 'object' && typeof x.boundingBox === 'function'
    let firstLoc = isLoc(items[0]) ? items[0].first() : page.locator(items[0]).first()
    await firstLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(300)
    await page.mouse.move(0, 0)
    let rects = []
    for (let it of items) {
        if (isLoc(it)) {
            let bb = await it.first().boundingBox()
            if (bb) {
                rects.push(bb)
            }
        }
        else {
            let r = await page.evaluate((s) => {
                let e = document.querySelector(s)
                if (!e) {
                    return null
                }
                let rc = e.getBoundingClientRect()
                return { x: rc.left, y: rc.top, width: rc.width, height: rc.height }
            }, it)
            if (r) {
                rects.push(r)
            }
        }
    }
    let maskRects = await page.evaluate((ms) => {
        let out = []
        ms.forEach((s) => {
            let sel = (typeof s === 'string') ? s : s.sel
            let e = document.querySelector(sel)
            if (!e) {
                return
            }
            let r = e.getBoundingClientRect()
            let left = r.left
            let width = r.width
            if (typeof s === 'object' && s.fixedWidth) {
                width = s.fixedWidth
                left = (r.left + r.width) - width
            }
            out.push({ x: left, y: r.top, w: width, h: r.height })
        })
        return out
    }, mask)
    let env = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY }))
    let buf = await ssoCaptureStable(page, opts)
    if (maskRects.length > 0) {
        buf = await ssoMaskRegions(buf, maskRects.map((r) => ({ x: r.x + env.sx, y: r.y + env.sy, w: r.w, h: r.h })))
    }
    if (rects.length > 0) {
        buf = await ssoComposeBox(buf, {
            left: Math.min(...rects.map((r) => r.x)) + env.sx,
            top: Math.min(...rects.map((r) => r.y)) + env.sy,
            right: Math.max(...rects.map((r) => r.x + r.width)) + env.sx,
            bottom: Math.max(...rects.map((r) => r.y + r.height)) + env.sy,
        })
    }
    return buf
}


//—— w-web-perm 凍結複本 (e2e-setup.mjs:313-320, 339-414, 423-480) ——
async function permMaskRegions(buf, rects, color = { r: 0, g: 0, b: 0 }) {
    const composite = rects.filter((r) => r.w > 0 && r.h > 0).map((r) => ({
        input: { create: { width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)), channels: 3, background: color } },
        left: Math.max(0, Math.round(r.x)), top: Math.max(0, Math.round(r.y)),
    }))
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}
async function permCaptureStable(page, opts = {}) {
    const { maxRetries = 8, intervalMs = 200, initialWaitMs = 1500 } = opts
    const strict = opts.strict ?? (process.env.E2E_STRICT_CAPTURE === '1')
    const shotOpts = { fullPage: true, animations: 'disabled' }
    await page.mouse.move(0, 0)
    await page.waitForTimeout(initialWaitMs)
    await page.evaluate(async () => {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
            const bars = Array.from(document.querySelectorAll('[style*="cursor:col-resize"], [style*="cursor: col-resize"]'))
            if (bars.length === 0) return
            if (bars.every((b) => parseFloat(getComputedStyle(b).opacity) === 1)) return
            await new Promise((r) => setTimeout(r, 50))
        }
    })
    await ssoWaitDrawerReady(page) //perm :326-334 與 sso 逐字相同
    await page.evaluate(() => {
        document.querySelectorAll('svg').forEach((svg) => {
            if (typeof svg.pauseAnimations === 'function') { svg.pauseAnimations(); if (typeof svg.setCurrentTime === 'function') svg.setCurrentTime(0) }
        })
    })
    await page.evaluate(() => (document.fonts && typeof document.fonts.ready?.then === 'function') ? document.fonts.ready : Promise.resolve())
    await page.evaluate(() => { document.querySelectorAll('.ag-body-horizontal-scroll-viewport, .ag-center-cols-viewport').forEach((e) => { e.scrollLeft = 0 }) }).catch(() => {})
    await page.waitForTimeout(300)
    const animatedRects = await page.evaluate(() => {
        const rects = []
        document.querySelectorAll('img').forEach((img) => {
            const src = img.src || ''
            if (!src.startsWith('data:image/svg+xml')) return
            let decoded = ''
            try { decoded = src.startsWith('data:image/svg+xml;base64,') ? atob(src.slice('data:image/svg+xml;base64,'.length)) : decodeURIComponent(src) }
            catch (e) { decoded = '' }
            if (/<animate/i.test(decoded)) { const r = img.getBoundingClientRect(); rects.push({ x: r.left, y: r.top, w: r.width, h: r.height }) }
        })
        return rects
    })
    const shot = async () => {
        let b = await page.screenshot(shotOpts)
        if (animatedRects.length > 0) b = await permMaskRegions(b, animatedRects)
        return b
    }
    let prev = await shot()
    for (let i = 0; i < maxRetries; i++) {
        await page.waitForTimeout(intervalMs)
        const curr = await shot()
        if (curr.equals(prev)) return curr
        prev = curr
    }
    if (strict) throw new Error(`captureStable ${maxRetries} 次仍未 settle（regen 拒絕寫入未穩定畫面）`)
    return prev
}
async function permCaptureStableWithBox(page, target, opts = {}) {
    const items = Array.isArray(target) ? target : [target]
    const isLoc = (x) => x && typeof x === 'object' && typeof x.boundingBox === 'function'
    const isRect = (x) => x && typeof x === 'object' && !isLoc(x) && ['x', 'y', 'width', 'height'].every((k) => typeof x[k] === 'number')
    if (!isRect(items[0])) {
        const firstLoc = isLoc(items[0]) ? items[0].first() : page.locator(items[0]).first()
        await firstLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    }
    await page.waitForTimeout(300)
    await page.mouse.move(0, 0)
    const rects = []
    for (const it of items) {
        if (isRect(it)) {
            rects.push(it)
        }
        else if (isLoc(it)) {
            const bb = await it.first().boundingBox()
            if (bb) rects.push(bb)
        }
        else {
            const r = await page.evaluate((s) => {
                const e = document.querySelector(s)
                if (!e) return null
                const rc = e.getBoundingClientRect()
                return { x: rc.left, y: rc.top, width: rc.width, height: rc.height }
            }, it)
            if (r) rects.push(r)
        }
    }
    const env = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight, sx: window.scrollX, sy: window.scrollY }))
    let buf = await permCaptureStable(page, opts)
    if (rects.length > 0) {
        const M = 3
        const left = Math.min(...rects.map((r) => r.x)) + env.sx
        const top = Math.min(...rects.map((r) => r.y)) + env.sy
        const right = Math.max(...rects.map((r) => r.x + r.width)) + env.sx
        const bottom = Math.max(...rects.map((r) => r.y + r.height)) + env.sy
        const bl = Math.max(env.sx + M, left - 6)
        const bt = Math.max(env.sy + M, top - 6)
        const br = Math.min(env.sx + env.vw - M, right + 6)
        const bb = Math.min(env.sy + env.vh - M, bottom + 6)
        const meta = await sharp(buf).metadata()
        const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">` +
            `<rect x="${bl + 2.5}" y="${bt + 2.5}" width="${br - bl - 5}" height="${bb - bt - 5}" fill="none" stroke="#f26" stroke-width="5" rx="4" ry="4"/>` +
            `</svg>`
        buf = await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
    }
    return buf
}

/* eslint-enable brace-style, promise/param-names, object-property-newline */


//—— 套件以選項重現各專案 ——
//凍結複本對 <img> 動畫區填黑; 2026-09-28 起套件預設改貼靜態影格(imgSmilFill:'static'), 等價對照須顯式 'black'
let SSO_SETTLE = { settle: [waitColResizeOverlay, waitDrawerReady], imgSmilFill: 'black' }
let pkgSsoCapture = (page, o = {}) => captureStable(page, { ...SSO_SETTLE, ...o })
let pkgSsoBox = (page, t, o = {}) => captureStableWithBox(page, t, { ...o, capture: pkgSsoCapture })
let pkgPermCapture = (page, o = {}) => captureStable(page, { ...SSO_SETTLE, beforeShots: [resetAgGridScroll], ...o })
let pkgPermBox = (page, t, o = {}) => captureStableWithBox(page, t, { ...o, clampTo: 'viewport', guardSmall: false, capture: pkgPermCapture })


//測試頁: 抽屜([state]、col-resize 分隔條延遲顯示)、表格(可水平捲動)、inline SVG SMIL、<img> 內 SVG SMIL、右對齊時鐘
//抽屜轉 opened 與分隔條顯示皆晚於初始等待(1500ms)且改變畫面, 使「漏掉 settle 掛鉤」必然截到不同畫面(見反向對照)
let smilImg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="5" fill="#09f"><animate attributeName="r" from="5" to="18" dur="0.6s" repeatCount="indefinite"/></circle></svg>')
let PAGE = `<!doctype html><html><body style="margin:0; font-family: Arial">
  <div state="opening" id="drawer" style="position:absolute; left:0; top:0; width:180px; height:500px; background:#eef">
    <div style="padding:10px">Nav item A</div><div style="padding:10px">導航項目 B</div>
  </div>
  <div id="bar" style="position:absolute; left:180px; top:0; width:6px; height:500px; background:#339; cursor: col-resize; opacity:0"></div>
  <div style="position:absolute; left:200px; top:20px; width:560px">
    <h3 id="title">Tokens 金鑰清單</h3>
    <div class="ag-center-cols-viewport" style="width:400px; overflow-x:scroll; border:1px solid #ccc">
      <div style="width:1200px"><div class="row" id="r0">row-0 test-token-1</div><div class="row" id="r1">row-1 test-token-2</div></div>
    </div>
    <svg width="60" height="30"><rect x="0" y="0" width="10" height="30" fill="#f90"><animate attributeName="width" from="10" to="60" dur="0.5s" repeatCount="indefinite"/></rect></svg>
    <img id="spin" src="${smilImg}" width="40" height="40">
    <div style="text-align:right"><span id="clock">12:34:56</span></div>
    <div style="height:900px"></div>
    <div id="far">far below</div>
  </div>
  <script>
    setTimeout(() => { let d = document.getElementById('drawer'); d.setAttribute('state', 'opened'); d.style.background = '#cfc' }, 3400)
    setTimeout(() => { document.getElementById('bar').style.opacity = '1' }, 2600)
    document.querySelector('.ag-center-cols-viewport').scrollLeft = 150
  </script>
</body></html>`


describe('截圖管線與各專案現行實作逐位元等價(無伺服器)', function() {
    this.timeout(180000)

    let browser = null
    let page = null
    let prevStrict = process.env.E2E_STRICT_CAPTURE

    before(async function() {
        browser = await launchBrowser()
    })
    after(async function() {
        if (browser) await browser.close()
        if (prevStrict === undefined) delete process.env.E2E_STRICT_CAPTURE
        else process.env.E2E_STRICT_CAPTURE = prevStrict
    })
    beforeEach(async function() {
        delete process.env.E2E_STRICT_CAPTURE
        let ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
        page = await ctx.newPage()
    })
    afterEach(async function() {
        if (page) await page.context().close()
    })

    //每次截圖前重新載入頁面, 各實作須自行等到穩定(不可吃到前一次已等完之狀態)
    let fresh = async () => {
        await page.setContent(PAGE)
        return page
    }

    it('sso: captureStable(抽屜等待、SVG 凍結、<img> 動畫遮黑)逐位元相同', async function() {
        let a = await ssoCaptureStable(await fresh())
        let b = await pkgSsoCapture(await fresh())
        assert.strict.ok(a.equals(b), '套件與 sso 現行 captureStable 輸出不同')
    })

    it('反向對照: 拿掉 settle 掛鉤即截到未穩定之畫面(證明上一條測試對掛鉤敏感)', async function() {
        let a = await ssoCaptureStable(await fresh())
        let b = await captureStable(await fresh(), { settle: [] })
        assert.strict.ok(!a.equals(b), '少了 settle 掛鉤仍相同, 測試頁未能區分')
    })

    it('sso: captureStableWithBox(選擇器目標 + 遮罩 fixedWidth)逐位元相同, 且確有紅框與遮罩', async function() {
        let o = { mask: [{ sel: '#clock', fixedWidth: 50 }] }
        let a = await ssoCaptureStableWithBox(await fresh(), ['#r0', '#r1'], o)
        let b = await pkgSsoBox(await fresh(), ['#r0', '#r1'], o)
        assert.strict.ok(a.equals(b), '套件與 sso 現行 captureStableWithBox 輸出不同')
        let plain = await pkgSsoCapture(await fresh())
        assert.strict.ok(!plain.equals(b), '應有紅框/遮罩而與無框截圖不同')
    })

    it('sso: Locator 目標、需捲動之目標(捲動量補正)逐位元相同(頁面無 <img> 動畫)', async function() {
        let noSmil = PAGE.replace(/<img id="spin"[^>]*>/, '')
        let load = async () => {
            await page.setContent(noSmil)
            return page
        }
        let a = await ssoCaptureStableWithBox(await load(), page.locator('#far'))
        let b = await pkgSsoBox(await load(), page.locator('#far'))
        assert.strict.ok(a.equals(b))
    })

    //頁面已捲動時, 舊「視窗座標」<img> 動畫遮罩會蓋錯位置(全頁截圖座標差一個捲動量), 動畫露出;
    //此時 Chrome 暫停視窗外 <img> 之動畫, 連拍仍會「穩定」但停在不固定之影格 → 跨次截圖不一致
    //(本檔早先版本以同一捲動頁比對 sso 凍結複本與套件即因此不同). 2026-09-28 起預設改為 page 座標(修正), viewport 僅供重現舊行為.
    it('缺陷修正實證: 捲動後舊視窗座標之遮罩不在 <img> 上; 預設(page)則遮在原位且兩次截圖逐位元相同', async function() {
        let scrolled = async () => {
            await page.setContent(PAGE)
            await page.locator('#far').scrollIntoViewIfNeeded()
            return page
        }
        let center = async (buf) => {
            let img = await page.evaluate(() => {
                let r = document.getElementById('spin').getBoundingClientRect()
                return { x: Math.round(r.left + window.scrollX + r.width / 2), y: Math.round(r.top + window.scrollY + r.height / 2), sy: window.scrollY }
            })
            let { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
            let i = (img.y * info.width + img.x) * info.channels
            return { rgb: Array.from(data.slice(i, i + 3)), sy: img.sy }
        }
        let v = await pkgSsoCapture(await scrolled(), { smilRectBasis: 'viewport' })
        let cv = await center(v)
        assert.strict.ok(cv.sy > 0, '頁面須已捲動')
        assert.strict.notDeepStrictEqual(cv.rgb, [0, 0, 0], '舊視窗座標遮罩不應落在 <img> 上(否則此缺陷不存在)')
        let p1 = await pkgSsoCapture(await scrolled(), { strict: true })
        assert.strict.deepStrictEqual((await center(p1)).rgb, [0, 0, 0], '預設(page)之 <img> 動畫區中心應被填黑')
        let p2 = await pkgSsoCapture(await scrolled(), { strict: true })
        assert.strict.ok(p1.equals(p2), '預設(page)遮罩時兩次截圖應逐位元相同')
    })

    //遮罩座標系須與截圖一致: 視窗截圖(fullPage:false)用視窗座標; clip 再減去 clip 原點(2026-09-28, sso stainfor clip 截圖改走 captureStable 前補正)
    it('視窗截圖與 clip 截圖: 頁面捲動後 <img> 動畫遮罩仍落在該截圖座標系之動畫中心', async function() {
        let prep = async () => {
            await page.setContent(PAGE)
            await page.evaluate(() => window.scrollTo(0, 100))
            return page
        }
        let pix = async (buf, x, y) => {
            let { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
            let i = (y * info.width + x) * info.channels
            return Array.from(data.slice(i, i + 3))
        }
        let spinVp = async () => page.evaluate(() => {
            let r = document.getElementById('spin').getBoundingClientRect()
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), sy: window.scrollY }
        })
        //視窗截圖
        let v = await pkgSsoCapture(await prep(), { strict: true, shotOpts: { fullPage: false } })
        let c = await spinVp()
        assert.strict.ok(c.sy > 0 && c.y > 0 && c.y < 600, `須已捲動且 <img> 在視窗內 (sy=${c.sy}, y=${c.y})`)
        assert.strict.deepStrictEqual(await pix(v, c.x, c.y), [0, 0, 0], '視窗截圖之 <img> 動畫中心應被填黑')
        //clip 截圖(clip 原點不為 0)
        let clip = { x: c.x - 60, y: c.y - 30, width: 200, height: 100 }
        let k = await pkgSsoCapture(await prep(), { strict: true, shotOpts: { fullPage: false, clip } })
        assert.strict.deepStrictEqual(await pix(k, 60, 30), [0, 0, 0], 'clip 截圖之 <img> 動畫中心(扣 clip 原點)應被填黑')
    })

    it('imgSmilFill static(預設): <img> 動畫區貼去掉動畫之靜態影格(非黑塊、兩次截圖逐位元相同; 動畫放大部分不出現)', async function() {
        let o = { settle: [waitColResizeOverlay, waitDrawerReady], strict: true }
        let a = await captureStable(await fresh(), o)
        let b = await captureStable(await fresh(), o)
        assert.strict.ok(a.equals(b), 'static 模式兩次截圖應逐位元相同')
        let g = await page.evaluate(() => {
            let r = document.getElementById('spin').getBoundingClientRect()
            return { cx: Math.round(r.left + window.scrollX + r.width / 2), cy: Math.round(r.top + window.scrollY + r.height / 2), l: Math.round(r.left + window.scrollX), t: Math.round(r.top + window.scrollY) }
        })
        let { data, info } = await sharp(a).raw().toBuffer({ resolveWithObject: true })
        let px = (x, y) => Array.from(data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
        let c = px(g.cx, g.cy)
        assert.strict.ok(Math.abs(c[0] - 0) <= 8 && Math.abs(c[1] - 153) <= 8 && Math.abs(c[2] - 255) <= 8, `中心應為靜態影格之圓(#09f), 實得 ${c}`)
        //靜態影格之圓 r=5; 距中心 12px 處(動畫中會被放大之圓蓋到)應為底色(取自區外左側)
        assert.strict.deepStrictEqual(px(g.cx + 12, g.cy), px(g.l - 2, g.cy), '動畫放大部分不應出現, 應為底色')
        let black = await captureStable(await fresh(), { ...o, imgSmilFill: 'black' })
        assert.strict.deepStrictEqual(await (async () => {
            let r = await sharp(black).raw().toBuffer({ resolveWithObject: true })
            let i = (g.cy * r.info.width + g.cx) * r.info.channels
            return Array.from(r.data.slice(i, i + 3))
        })(), [0, 0, 0], 'imgSmilFill:\'black\' 仍為填黑(舊行為)')
    })

    it('perm: 以 beforeShots(ag-grid 歸零) + clampTo viewport + guardSmall false 重現, 逐位元相同', async function() {
        let a = await permCaptureStableWithBox(await fresh(), ['#title', '#r1'])
        let b = await pkgPermBox(await fresh(), ['#title', '#r1'])
        assert.strict.ok(a.equals(b), '套件與 perm 現行 captureStableWithBox 輸出不同')
        let c = await pkgSsoBox(await fresh(), ['#title', '#r1'])
        assert.strict.ok(!c.equals(b), 'perm 設定(ag-grid 歸零)應與 sso 設定之畫面不同')
    })

    it('perm: 矩形目標(不捲動)逐位元相同', async function() {
        let rect = { x: 210, y: 30, width: 120, height: 40 }
        let a = await permCaptureStableWithBox(await fresh(), rect)
        let b = await pkgPermBox(await fresh(), rect)
        assert.strict.ok(a.equals(b))
    })

    it('strict: 永不穩定之頁面 → 顯式 strict 拋錯; 未給時於呼叫當下讀 E2E_STRICT_CAPTURE(import 後才設亦生效)', async function() {
        await page.setContent('<div id="t">0</div><script>let n = 0; setInterval(() => { document.getElementById("t").textContent = String(++n) }, 30)</script>')
        await assert.rejects(captureStable(page, { strict: true, initialWaitMs: 100, maxRetries: 3 }), /仍未 settle/)
        let last = await captureStable(page, { initialWaitMs: 100, maxRetries: 3 })
        assert.strict.ok(Buffer.isBuffer(last))
        process.env.E2E_STRICT_CAPTURE = '1'
        await assert.rejects(captureStable(page, { initialWaitMs: 100, maxRetries: 3 }), /仍未 settle/)
        await assert.rejects(captureStable(page, { initialWaitMs: 100, maxRetries: 3, strictDefault: () => false, strict: null }).then(() => {
            throw new Error('strictDefault 應可覆寫環境變數')
        }), /strictDefault 應可覆寫/)
    })

    it('shotOpts: fullPage 可關(視窗截圖尺寸 = 視窗)', async function() {
        let b = await captureStable(await fresh(), { ...SSO_SETTLE, shotOpts: { fullPage: false } })
        let meta = await sharp(b).metadata()
        assert.strict.deepStrictEqual([meta.width, meta.height], [800, 600])
    })

    it('無框防護: 目標找不到 / 尺寸為 0 / 夾邊後過小 → 拋錯(不產出無框圖); allowNoBox:true 才回無框圖', async function() {
        await page.setContent('<div id="ok" style="position:absolute;left:40px;top:40px;width:120px;height:60px;background:#ddd">ok</div>' +
            '<div id="zero" style="position:absolute;left:10px;top:10px;width:0;height:0"></div>')
        //找不到
        await assert.rejects(() => captureStableWithBox(page, '#nope', { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0 }), /紅框目標皆找不到或尺寸為 0/)
        //尺寸為 0(選擇器與矩形皆然)
        await assert.rejects(() => captureStableWithBox(page, '#zero', { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0 }), /紅框目標皆找不到或尺寸為 0/)
        await assert.rejects(() => captureStableWithBox(page, { x: 5, y: 5, width: 0, height: 20 }, { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0 }), /紅框目標皆找不到或尺寸為 0/)
        //夾邊後過小(矩形在截圖外)
        await assert.rejects(() => captureStableWithBox(page, { x: 5000, y: 5000, width: 30, height: 30 }, { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0 }), /紅框未畫出/)
        //聯集中含 0 尺寸者但另有正常目標: 照畫(聯集幾何不變)
        let b1 = await captureStableWithBox(page, ['#ok', '#zero'], { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0 })
        assert.ok(Buffer.isBuffer(b1))
        //明示容許無框
        let b2 = await captureStableWithBox(page, '#nope', { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0, allowNoBox: true })
        let raw = await sharp(b2).raw().toBuffer({ resolveWithObject: true })
        let red = 0
        for (let i = 0; i < raw.data.length; i += raw.info.channels) {
            if (raw.data[i] === 255 && raw.data[i + 1] === 34 && raw.data[i + 2] === 102) {
                red++
            }
        }
        assert.strict.equal(red, 0, 'allowNoBox 之圖不應有紅框像素')
    })

})


//量測型目標(2026-09-28): 框對象由頁面內容決定(表格標頭＋可見資料列、清單可見項目之聯集), 於捲入與等待之後量
let GRID_PAGE = (rows, extra = '') => `<!doctype html><html><head><style>
  body { margin: 0; font: 14px sans-serif; }
  .ag-root-wrapper { position: absolute; left: 50px; top: 60px; width: 600px; height: 400px; border: 1px solid #999; }
  .ag-header { height: 64px; background: #eee; }
  .ag-body-viewport { position: absolute; left: 0; right: 0; top: 64px; bottom: 0; overflow: hidden; }
  .ag-row { position: absolute; left: 0; width: 700px; height: 28px; border-bottom: 1px solid #ddd; }
  .ag-overlay-no-rows-center { position: absolute; left: 260px; top: 180px; }
</style></head><body>
  <div class="ag-root-wrapper"><div class="ag-header">h</div><div class="ag-body-viewport">
    ${rows.map((t) => `<div class="ag-row" style="top:${t}px">r</div>`).join('')}
    ${extra}
  </div></div>
</body></html>`

let redBBox = async (buf) => {
    let { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    let b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            let i = (y * info.width + x) * info.channels
            if (data[i] === 255 && data[i + 1] === 34 && data[i + 2] === 102) {
                b.x0 = Math.min(b.x0, x)
                b.y0 = Math.min(b.y0, y)
                b.x1 = Math.max(b.x1, x)
                b.y1 = Math.max(b.y1, y)
            }
        }
    }
    return b
}

describe('量測型目標: gridContentBox、itemsUnionBox(無伺服器)', function() {
    this.timeout(120000)

    let browser = null
    let page = null
    let fast = { maxRetries: 2, intervalMs: 50, initialWaitMs: 0, preWaitMs: 0, scrollTimeoutMs: 500 }

    before(async function() {
        browser = await launchBrowser()
    })
    after(async function() {
        if (browser) await browser.close()
    })
    beforeEach(async function() {
        let ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
        page = await ctx.newPage()
    })
    afterEach(async function() {
        if (page) await page.context().close()
    })

    it('gridContentBox: 標頭 ∪ 可見資料列, 夾在表格框內(寬取表格框, 列寬超出者被夾; 不含下方空白)', async function() {
        await page.setContent(GRID_PAGE([0, 28, 56]))
        let r = await gridContentBox('.ag-root-wrapper').measure(page)
        //表格框 left 50..652(寬 600+邊框 2) top 60 ; 標頭 51..651 × 61..125 ; 列寬 700 超出 → 右緣夾到 652 ; 第三列 top 125+56=181, 底 181+29(含下框線)=210
        assert.strict.deepStrictEqual([r.x, r.y, r.width, r.height], [51, 61, 601, 149])
    })

    it('gridContentBox: 捲出資料捲動區之列不計入; 無資料列時取標頭 ∪「無資料」訊息', async function() {
        await page.setContent(GRID_PAGE([0, 500]))
        let r = await gridContentBox('.ag-root-wrapper').measure(page)
        assert.strict.deepStrictEqual([r.y, r.height], [61, 93], '只含第一列(第二列 top 500 在捲動區外)')
        await page.setContent(GRID_PAGE([], '<span class="ag-overlay-no-rows-center">No Rows To Show</span>'))
        let e = await gridContentBox('.ag-root-wrapper').measure(page)
        let span = await page.evaluate(() => document.querySelector('.ag-overlay-no-rows-center').getBoundingClientRect().bottom)
        //訊息為無可見邊界之文字, 外擴 INK_PAD(4): 框底取訊息底 + 4, 框內緣(目標外擴 6、描邊 5 內縮)距訊息行框 5px(2026-09-30)
        assert.strict.deepStrictEqual([e.y, e.y + e.height], [61, span + 4], '空表: 標頭頂至訊息底外擴 4px')
        let f = await gridContentBox('.ag-root-wrapper', { noRowsPad: 0 }).measure(page)
        assert.strict.deepStrictEqual(f.y + f.height, span, 'noRowsPad:0 時為訊息底(舊行為)')
    })

    it('gridContentBox: 空表之「無資料」訊息外擴後仍夾在表格框內', async function() {
        //訊息貼齊資料捲動區底(表格框 60..462 含 1px 邊框, 捲動區底 461): 外擴 4 後 465 超出, 夾回表格框底 462
        await page.setContent(GRID_PAGE([], '<span class="ag-overlay-no-rows-center" style="top:auto; bottom:0px;">No Rows To Show</span>'))
        let e = await gridContentBox('.ag-root-wrapper').measure(page)
        let [span, rr] = await page.evaluate(() => [document.querySelector('.ag-overlay-no-rows-center').getBoundingClientRect().bottom, document.querySelector('.ag-root-wrapper').getBoundingClientRect().bottom])
        assert.strict.deepStrictEqual([span, e.y + e.height], [461, rr], `訊息底 ${span}, 框底夾在表格框底 ${rr}`)
    })

    it('gridContentBox: 欄位未撐滿表格寬(右側空白 ≥200px 且 ≥30%)時右緣收在最後一欄; 撐滿者(右側僅捲軸槽)不收', async function() {
        let narrow = (cellsW) => `<!doctype html><html><head><style>
          body { margin: 0; font: 14px sans-serif; }
          .ag-root-wrapper { position: absolute; left: 50px; top: 60px; width: 600px; height: 400px; }
          .ag-header { position: relative; height: 64px; }
          .ag-header-cell { position: absolute; top: 0; height: 32px; background: #eee; }
          .ag-body-viewport { position: absolute; left: 0; right: 0; top: 64px; bottom: 0; overflow: hidden; }
          .ag-row { position: absolute; left: 0; height: 28px; }
        </style></head><body><div class="ag-root-wrapper"><div class="ag-header">
          <div class="ag-header-cell" style="left:0;width:${cellsW / 2}px">a</div><div class="ag-header-cell" style="left:${cellsW / 2}px;width:${cellsW / 2}px">b</div>
        </div><div class="ag-body-viewport"><div class="ag-row" style="top:0;width:${cellsW}px">r</div><div class="ag-row" style="top:28px;width:${cellsW}px">r</div></div></div></body></html>`
        await page.setContent(narrow(260))
        let r = await gridContentBox('.ag-root-wrapper').measure(page)
        assert.strict.deepStrictEqual([r.x, r.width], [50, 260], '兩欄 260px、表格寬 600: 右側空白 340 ≥ 200 且 ≥ 30% → 收在最後一欄')
        await page.setContent(narrow(564))
        let f = await gridContentBox('.ag-root-wrapper').measure(page)
        assert.strict.deepStrictEqual([f.x, f.width], [50, 600], '欄位撐滿(右側僅 36px 捲軸槽) → 不收, 維持表格框寬')
    })

    it('gridContentBox: 表格框找不到 → null; captureStableWithBox 因此拋錯(不產出無框圖)', async function() {
        await page.setContent('<div>no grid</div>')
        assert.strict.equal(await gridContentBox('.ag-root-wrapper').measure(page), null)
        await assert.rejects(() => captureStableWithBox(page, gridContentBox('.ag-root-wrapper'), fast), /紅框目標皆找不到或尺寸為 0 \(gridContentBox\(\.ag-root-wrapper\)\)/)
    })

    it('itemsUnionBox: 可見項目之聯集(略過 display:none / visibility:hidden / 範圍外), 夾在範圍容器內', async function() {
        await page.setContent(`<div id="tree" style="position:absolute;left:20px;top:20px;width:300px;height:500px;overflow:hidden">
            <div class="it" style="position:absolute;left:10px;top:10px;width:120px;height:24px">a</div>
            <div class="it" style="position:absolute;left:30px;top:40px;width:200px;height:24px">b</div>
            <div class="it" style="position:absolute;left:10px;top:70px;width:250px;height:24px;display:none">c</div>
            <div class="it" style="position:absolute;left:10px;top:100px;width:280px;height:24px;visibility:hidden">d</div>
            <div class="it" style="position:absolute;left:10px;top:900px;width:280px;height:24px">far</div>
          </div><div class="it" style="position:absolute;left:600px;top:10px;width:50px;height:20px">out</div>`)
        let r = await itemsUnionBox('.it', { within: '#tree' }).measure(page)
        assert.strict.deepStrictEqual([r.x, r.y, r.width, r.height], [30, 30, 220, 54])
        let all = await itemsUnionBox(['#tree .it', '.it'], {}).measure(page)
        assert.strict.deepStrictEqual([all.x, all.y, all.x + all.width], [30, 10, 650], '未給 within: 整頁查找、夾在視窗內(far 在視窗外不計)')
        assert.strict.equal(await itemsUnionBox('.none', { within: '#tree' }).measure(page), null)
        assert.strict.equal(await itemsUnionBox('.it', { within: '#nope' }).measure(page), null)
        assert.throws(() => itemsUnionBox(''), /itemsUnionBox: itemSel 須為非空/)
    })

    it('itemsUnionBox fit: 無邊界之整列文字改量墨跡、flex 列改量可見子元素聯集(外擴 4); 有邊框之晶片仍量元素本身(含內距與邊框)', async function() {
        await page.setContent(`<div style="position:absolute;left:0;top:0;width:700px;font:16px sans-serif">
            <div id="t" class="h">Short title</div>
            <span id="chip" class="h" style="display:inline-flex;padding:8px 13px;border:1px solid #999">GET /x</span>
            <div id="pills" style="display:flex;gap:7px;margin:10px 0 0 20px"><span class="p" style="width:40px;height:20px;background:#ddd">a</span><span class="p" style="width:60px;height:20px;background:#ddd">b</span></div>
          </div>`)
        let blockW = await page.evaluate(() => document.getElementById('t').getBoundingClientRect().width)
        assert.strict.equal(blockW, 700, 'block 級元素本身撐滿整列')
        let noFit = await itemsUnionBox('#t').measure(page)
        assert.strict.equal(noFit.width, 700, '未給 fit: 量元素本身(整列寬)')
        let ink = await itemsUnionBox('#t', { fit: true }).measure(page)
        assert.strict.ok(ink.width > 0 && ink.width < 150, `fit: 只量文字墨跡(實得 ${ink.width})`)
        let chip = await page.evaluate(() => document.getElementById('chip').getBoundingClientRect())
        let c = await itemsUnionBox('#chip', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([c.x, c.width], [chip.x, chip.width], 'fit: inline 級晶片仍量元素本身')
        let p = await itemsUnionBox('#pills', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([p.x, p.width], [16, 115], 'fit: flex 列量可見子元素聯集(20 起, 40 + 7 + 60)並外擴 4')
    })

    it('itemsUnionBox fit inkPad: 無邊界者之可見內容(文字與有邊界之子元素)一律外擴 inkPad(預設 4); 有可見邊界者量元素本身; inkPad:0 即原墨跡; 非法 inkPad 拋錯', async function() {
        //各項以 30px 間距分開(相鄰夾邊只在間距 < 2×(inkPad+3.5) 時作用, 另有專測), 本測只驗墨跡外擴與可見邊界判準
        await page.setContent(`<div style="position:absolute;left:100px;top:40px;width:600px;font:16px sans-serif;display:flex;flex-direction:column;align-items:flex-start;gap:30px">
            <div id="t" style="align-self:stretch">Short title</div>
            <div><span id="s">inline text</span></div>
            <span id="chip" style="display:inline-flex;padding:8px 13px;border:1px solid #999">GET /x</span>
            <div><div id="sw" style="display:inline-flex;align-items:center;cursor:pointer"><span id="track" style="display:inline-block;width:36px;height:30px;background:#1565c0"></span><span id="lbl" style="margin-left:6px">Edit mode</span></div></div>
            <div id="bar" style="align-self:stretch;background:#fde;padding:0">Banner text</div>
          </div>`)
        let raw = await page.evaluate(() => {
            let rect = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom })
            let one = (id) => {
                let rg = document.createRange()
                rg.selectNodeContents(document.getElementById(id))
                return rect(rg.getBoundingClientRect())
            }
            let el = (id) => rect(document.getElementById(id).getBoundingClientRect())
            return { t: one('t'), s: one('s'), chip: el('chip'), track: el('track'), lbl: one('lbl'), bar: el('bar') }
        })
        let t = await itemsUnionBox('#t', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([t.x, t.y, t.width, t.height], [raw.t.x - 4, raw.t.y - 4, raw.t.w + 8, raw.t.h + 8], 'block 級整行文字: 墨跡 ±4')
        let s = await itemsUnionBox('#s', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([s.x, s.y, s.width, s.height], [raw.s.x - 4, raw.s.y - 4, raw.s.w + 8, raw.s.h + 8], 'display:inline 文字: 墨跡 ±4')
        let c = await itemsUnionBox('#chip', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([c.x, c.y, c.width, c.height], [raw.chip.x, raw.chip.y, raw.chip.w, raw.chip.h], '有邊框之晶片: 元素本身, 不外擴')
        //無邊界之 inline-flex 開關: 軌道(有底色之子元素)與標籤文字之聯集一律外擴 4——軌道同留白(原不外擴, 框線貼軌道 1px)
        let sw = await itemsUnionBox('#sw', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([sw.x, sw.x + sw.width], [raw.track.x - 4, raw.lbl.r + 4], '無邊界開關: 軌道左緣 -4 ~ 標籤墨跡右緣 +4')
        assert.strict.deepStrictEqual([sw.y, sw.y + sw.height], [Math.min(raw.track.y, raw.lbl.y) - 4, Math.max(raw.track.b, raw.lbl.b) + 4])
        let bar = await itemsUnionBox('#bar', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([bar.x, bar.width], [raw.bar.x, raw.bar.w], '有底色之整列: 元素本身(底色即其視覺邊界)')
        let t0 = await itemsUnionBox('#t', { fit: true, inkPad: 0 }).measure(page)
        assert.strict.deepStrictEqual([t0.x, t0.width], [raw.t.x, raw.t.w], 'inkPad:0 即原墨跡')
        let noFit = await itemsUnionBox('#s').measure(page)
        assert.strict.deepStrictEqual([noFit.x, noFit.width], [raw.s.x, raw.s.w], '未給 fit: 不外擴')
        assert.throws(() => itemsUnionBox('#t', { fit: true, inkPad: -1 }), /inkPad 須為非負數/)
        //底色與背後相同(白頁上之白卡)不算可見邊界 → 量內容並外擴墨跡; 灰頁上之白卡 → 元素本身
        await page.setContent(`<div style="position:absolute;left:100px;top:100px;width:500px;font:16px sans-serif">
            <div id="w1" style="background:#fff">Event Statistics</div>
            <div style="background:#eee;padding:20px"><div id="w2" style="background:#fff">Event Statistics</div></div>
          </div>`)
        let w = await page.evaluate(() => {
            let rg = document.createRange()
            rg.selectNodeContents(document.getElementById('w1'))
            let r = rg.getBoundingClientRect()
            let e2 = document.getElementById('w2').getBoundingClientRect()
            return { ink: { x: r.left, w: r.width }, w2: { x: e2.left, w: e2.width } }
        })
        let w1 = await itemsUnionBox('#w1', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([w1.x, w1.width], [w.ink.x - 4, w.ink.w + 8], '白頁上之白卡: 無可見邊界, 墨跡 ±4')
        let w2 = await itemsUnionBox('#w2', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([w2.x, w2.width], [w.w2.x, w.w2.w], '灰頁上之白卡: 元素本身')
        //只有分隔線(單邊 border-top)之整條工具列: 不算可見邊界 → 量其上項目; 四邊框線者算
        await page.setContent(`<div style="position:absolute;left:100px;top:100px;width:600px;font:16px sans-serif">
            <div id="tb" style="padding:5px;border-top:1px solid #ddd;display:flex;align-items:center"><span style="display:inline-block;width:40px;height:24px;background:#f80"></span><span style="margin-left:6px">Edit mode</span></div>
            <div id="bx" style="margin-top:20px;padding:5px;border:1px solid #ddd">boxed</div>
          </div>`)
        let tbEl = await page.evaluate(() => document.getElementById('tb').getBoundingClientRect().width)
        let tb = await itemsUnionBox('#tb', { fit: true }).measure(page)
        assert.ok(tbEl === 600 && tb.width < 200, `單邊分隔線之工具列量其上項目(元素寬 ${tbEl}, 實得 ${tb.width})`)
        let bxEl = await page.evaluate(() => document.getElementById('bx').getBoundingClientRect())
        let bx = await itemsUnionBox('#bx', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([bx.x, bx.width], [bxEl.left, bxEl.width], '四邊框線之區塊: 元素本身')
    })

    it('itemsUnionBox fit 不壓相鄰項目: 緊鄰清單(每項外包 div)之框線中心落在兩項文字間隙正中; 左右相鄰同理; 相距遠者不受影響', async function() {
        await page.setContent(`<div style="position:absolute;left:100px;top:100px;width:400px;font:16px sans-serif">
            <div id="list">
              <div style="height:24px"><div id="i1" style="display:inline-block">Write users</div></div>
              <div style="height:24px"><div id="i2" style="display:inline-block">Read tokens</div></div>
              <div style="height:24px"><div id="i3" style="display:inline-block">Write tokens</div></div>
            </div>
            <div style="margin-top:60px;display:flex"><span id="a" style="display:inline-block;width:30px;height:20px;background:#ccc"></span><span id="b">Label</span><span id="c" style="display:inline-block;width:30px;height:20px;background:#ccc"></span></div>
            <div id="far" style="margin-top:80px">Far item</div>
          </div>`)
        let g = await page.evaluate(() => {
            let txt = (id) => {
                let rg = document.createRange()
                rg.selectNodeContents(document.getElementById(id))
                let r = rg.getBoundingClientRect()
                return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
            }
            return { t1: txt('i1'), t2: txt('i2'), t3: txt('i3'), far: txt('far'), b: txt('b') }
        })
        let r2 = await itemsUnionBox('#i2', { fit: true }).measure(page)
        //框線中心 = 目標邊 - (BOX_PAD 6 - BOX_STROKE/2 2.5) = 目標邊 ∓ 3.5; 上下鄰項之文字間隙 24 - 行高 ≈ 5.6 < 2 × (4 + 3.5), 故中心落在間隙正中
        let near = (a, b) => Math.abs(a - b) < 0.01
        assert.ok(near(r2.y - 3.5, (g.t1.bottom + g.t2.top) / 2), `上緊鄰: 框線中心在上項文字與本項文字間隙正中(實得 ${r2.y - 3.5}, 應 ${(g.t1.bottom + g.t2.top) / 2})`)
        assert.ok(near(r2.y + r2.height + 3.5, (g.t2.bottom + g.t3.top) / 2), `下緊鄰: 框線中心在本項文字與下項文字間隙正中(實得 ${r2.y + r2.height + 3.5})`)
        let rb = await itemsUnionBox('#b', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([rb.x, rb.x + rb.width], [g.b.left + 3.5, g.b.right - 3.5], '左右緊鄰(有底色之鄰項): 框線中心落在兩項交界')
        let rf = await itemsUnionBox('#far', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([rf.y, rf.y + rf.height], [g.far.top - 4, g.far.bottom + 4], '相距遠者不受影響(墨跡 ±4)')
    })

    it('itemsUnionBox fit 浮層: 四周無內容照常外擴(不強制畫在內側); 觸發區與被蓋住一部分之晶片以間隙正中為界(框線可退入浮層內距); 遮罩後之背景不算; 透明點擊攔截層可穿透', async function() {
        let popHtml = (extra = '') => `${extra}<div id="pop" style="position:fixed;z-index:20;left:200px;top:149px;width:120px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif">
            <div id="it1" tabindex="0" style="padding:7px 3px">OR</div><div id="it2" tabindex="0" style="padding:7px 3px">AND</div></div>`
        let geo = () => page.evaluate(() => {
            let r = document.getElementById('pop').getBoundingClientRect()
            let txt = (id) => {
                let rg = document.createRange()
                rg.selectNodeContents(document.getElementById(id))
                let q = rg.getBoundingClientRect()
                return { l: q.left, t: q.top, r: q.right, b: q.bottom }
            }
            let a = txt('it1')
            let b = txt('it2')
            return { pop: { l: r.left, t: r.top, r: r.right, b: r.bottom }, it1: a, inner: { l: Math.min(a.l, b.l), t: a.t, r: Math.max(a.r, b.r), b: b.b } }
        })
        let near = (a, b) => Math.abs(a - b) < 0.01
        //①四周無內容: 浮層本身(有陰影＝可見邊界)照常量元素本身、外擴; 內距 3px 之項目亦照常外擴(首版強制收在浮層內, 框線距字 1px)
        await page.setContent(popHtml())
        let g = await geo()
        let pb = await itemsUnionBox('#pop', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([pb.x, pb.y, pb.x + pb.width, pb.y + pb.height], [g.pop.l, g.pop.t, g.pop.r, g.pop.b], '浮層四周無內容: 量元素本身(框線畫在外側)')
        let ib = await itemsUnionBox('#it1', { fit: true }).measure(page)
        assert.strict.equal(ib.x, g.it1.l - 4, '浮層內項目四周無內容: 墨跡 -4(可越出浮層邊, 不強制收在內)')
        //②上方觸發區相距 1px、右側晶片被浮層蓋住一部分: 框線中心置於「浮層內容」與「浮層外內容」之間隙正中
        let around = `<div id="trg" style="position:absolute;left:200px;top:120px;width:120px;height:28px;border:1px solid #999;box-sizing:border-box;font:14px sans-serif">OR ▲</div>
            <div id="chip" style="position:absolute;left:300px;top:160px;width:90px;height:24px;background:#eee;border:1px solid #bbb;box-sizing:border-box;font:12px sans-serif">P2</div>`
        await page.setContent(popHtml(around))
        g = await geo()
        pb = await itemsUnionBox('#pop', { fit: true }).measure(page)
        assert.ok(near(pb.y - 3.5, (148 + g.inner.t) / 2), `上: 框線中心在觸發區下緣(148)與首項文字上緣之間隙正中(實得 ${pb.y - 3.5}, 應 ${(148 + g.inner.t) / 2})`)
        assert.ok(near(pb.x + pb.width + 3.5, (g.inner.r + 319) / 2), `右: 框線中心在項目文字右緣與晶片可見左緣(浮層外第一點 320 之前 319)之間隙正中(實得 ${pb.x + pb.width + 3.5})`)
        assert.ok(pb.x + pb.width + 6 <= g.pop.r, '右: 框線退入浮層內距, 不蓋晶片')
        assert.strict.deepStrictEqual([pb.x, pb.y + pb.height], [g.pop.l, g.pop.b], '左、下無內容: 照常外擴')
        //③晶片在遮罩之後(遮罩 z 10、浮層 z 20): 背景已調暗不算內容 → 右側照常外擴
        await page.setContent(popHtml(`${around}<div style="position:fixed;z-index:10;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,.3)"></div>`))
        pb = await itemsUnionBox('#pop', { fit: true }).measure(page)
        assert.strict.equal(pb.x + pb.width, g.pop.r, '遮罩後之晶片不算內容: 右側照常外擴')
        //④透明全畫面點擊攔截層(z 10): 穿透找到其後之晶片 → 同②
        await page.setContent(popHtml(`${around}<div style="position:fixed;z-index:10;left:0;top:0;width:100vw;height:100vh"></div>`))
        pb = await itemsUnionBox('#pop', { fit: true }).measure(page)
        assert.ok(near(pb.x + pb.width + 3.5, (g.inner.r + 319) / 2), `透明攔截層可穿透: 右側同②(實得 ${pb.x + pb.width + 3.5})`)
        //⑤元件庫常見結構「透明之 fixed 外層 + 有底色陰影之內層面板」(WPopperFix): 框外層 = 框面板(不另外擴 4); 觸發區在上方 1px 時同②取面板內容與觸發區之間隙正中
        let wrapHtml = (extra = '') => `${extra}<div id="wrap" style="position:fixed;z-index:20;left:200px;top:149px"><div id="panel" style="padding:8px 10px;width:100px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div id="w1">English</div><div id="w2" style="margin-top:12px">中文</div></div></div>`
        let wgeo = () => page.evaluate(() => {
            let p = document.getElementById('panel').getBoundingClientRect()
            let rg = document.createRange()
            rg.selectNodeContents(document.getElementById('w1'))
            let q = rg.getBoundingClientRect()
            return { panel: { l: p.left, t: p.top, r: p.right, b: p.bottom }, w1Top: q.top }
        })
        await page.setContent(wrapHtml())
        let wg = await wgeo()
        let wb = await itemsUnionBox('#wrap', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([wb.x, wb.y, wb.x + wb.width, wb.y + wb.height], [wg.panel.l, wg.panel.t, wg.panel.r, wg.panel.b], '透明外層之可見內容恰為單一面板: 同直接框面板, 不另外擴')
        await page.setContent(wrapHtml(`<div id="trg" style="position:absolute;left:200px;top:120px;width:120px;height:28px;border:1px solid #999;box-sizing:border-box;font:14px sans-serif">English ▲</div>`))
        wg = await wgeo()
        wb = await itemsUnionBox('#wrap', { fit: true }).measure(page)
        assert.ok(near(wb.y - 3.5, (148 + wg.w1Top) / 2), `外層包裝: 上緣框線中心在觸發區下緣(148)與面板首項文字上緣之間隙正中(實得 ${wb.y - 3.5}, 應 ${(148 + wg.w1Top) / 2})`)
        assert.ok(wb.y - 6 >= 148 + 1, `外層包裝: 框線外緣不碰觸發區(外緣 ${wb.y - 6})`)
        //⑥內容撐滿面板寬(全寬標頭) + 背景晶片緊貼面板右側、上下無內容: 上下緣照常外擴(沿線取樣不取在邊線上, 否則右緣端點誤判緊貼右側之晶片為上下方內容); 右緣取間隙正中
        await page.setContent(`<div id="chipR" style="position:absolute;left:320px;top:140px;width:60px;height:100px;background:#eee;border:1px solid #bbb;box-sizing:border-box"></div>
            <div id="pop3" style="position:fixed;z-index:20;left:200px;top:149px;width:120px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div style="background:#e8e8e8;padding:4px">Head</div><div style="padding:6px 8px">Item</div></div>`)
        let p3 = await page.evaluate(() => {
            let r = document.getElementById('pop3').getBoundingClientRect()
            let tr = 0
            for (let d of document.querySelectorAll('#pop3 > div')) {
                let rg = document.createRange()
                rg.selectNodeContents(d)
                tr = Math.max(tr, rg.getBoundingClientRect().right)
            }
            return { l: r.left, t: r.top, r: r.right, b: r.bottom, textR: tr }
        })
        let b3 = await itemsUnionBox('#pop3', { fit: true }).measure(page)
        assert.strict.deepStrictEqual([b3.y, b3.y + b3.height], [p3.t, p3.b], `上下無內容: 照常外擴(實得 ${JSON.stringify(b3)})`)
        //全寬標頭為結構性底色, 內容範圍取其文字 → 右緣框線退到「文字右緣」與「晶片左緣 320」之間隙正中, 不壓晶片
        assert.ok(near(b3.x + b3.width + 3.5, (p3.textR + 320) / 2), `右: 框線中心在浮層內文字右緣與晶片之間隙正中(實得 ${b3.x + b3.width + 3.5}, 應 ${(p3.textR + 320) / 2})`)
        assert.ok(b3.x + b3.width + 6 <= 320, '右: 框線外緣不碰晶片')
    })

    it('itemsUnionBox fit 鄰項以可見範圍計: 鄰項透明內距不把框線拉回目標文字; 空白間隔不算鄰項; 四向各取最近一層之鄰項', async function() {
        //PERM 編輯模式開關殷鑑: 右側圖示鈕之元素框(內距 12)緊貼標籤, 以元素框取中點時框線壓回「mode」; 應以圖示(svg)左緣取中點
        await page.setContent(`<div style="position:absolute;left:100px;top:100px;font:16px sans-serif">
            <div style="display:flex;align-items:center">
              <div id="sw" style="display:inline-flex;align-items:center"><span style="display:inline-block;width:36px;height:14px;background:#fb8;border-radius:7px"></span><span id="lbl" style="margin-left:6px">Edit mode</span></div>
              <div id="btn" role="button" style="padding:12px;display:inline-flex"><svg id="ico" width="18" height="18"><rect width="18" height="18" fill="#555"/></svg></div>
            </div>
            <div style="display:flex;align-items:center;margin-top:40px">
              <span id="alpha">Alpha</span><div id="spacer" style="width:20px;height:20px"></div><span style="display:inline-block;width:30px;height:20px;background:#ccc;margin-left:20px"></span>
            </div>
            <div style="display:flex;align-items:center;margin-top:40px">
              <div id="grp" style="display:flex;align-items:center"><span id="sq" style="display:inline-block;width:20px;height:20px;background:#9cf"></span><span id="tg" style="margin-left:2px">Target</span></div>
              <span id="or" style="display:inline-block;width:20px;height:20px;background:#fc9;margin-left:2px"></span>
            </div>
          </div>`)
        let g = await page.evaluate(() => {
            let txt = (id) => {
                let rg = document.createRange()
                rg.selectNodeContents(document.getElementById(id))
                let r = rg.getBoundingClientRect()
                return { left: r.left, right: r.right }
            }
            let el = (id) => {
                let r = document.getElementById(id).getBoundingClientRect()
                return { left: r.left, right: r.right }
            }
            return { lbl: txt('lbl'), btn: el('btn'), ico: el('ico'), alpha: txt('alpha'), sq: el('sq'), tg: txt('tg'), or: el('or') }
        })
        let near = (a, b) => Math.abs(a - b) < 0.01
        assert.ok(g.btn.left - g.lbl.right < 1 && g.ico.left - g.lbl.right > 10, `夾具: 按鈕元素框緊貼標籤、圖示在其內距之後(${JSON.stringify(g)})`)
        let sw = await itemsUnionBox('#sw', { fit: true }).measure(page)
        let swStroke = sw.x + sw.width + 3.5
        assert.ok(near(swStroke, (g.lbl.right + g.ico.left) / 2), `框線中心在標籤文字與圖示之間隙正中(實得 ${swStroke}, 應 ${(g.lbl.right + g.ico.left) / 2})`)
        assert.ok(swStroke - 2.5 - g.lbl.right >= 3, `框線內緣距標籤文字 ≥ 3px(實得 ${swStroke - 2.5 - g.lbl.right})`)
        let al = await itemsUnionBox('#alpha', { fit: true }).measure(page)
        assert.strict.equal(al.x + al.width, g.alpha.right + 4, '空白間隔不算鄰項: 右緣維持墨跡 +4(遠處之晶片中點在框外)')
        let tg = await itemsUnionBox('#tg', { fit: true }).measure(page)
        assert.ok(near(tg.x - 3.5, (g.sq.right + g.tg.left) / 2), `左鄰項(同層): 框線中心在間隙正中(實得 ${tg.x - 3.5})`)
        assert.ok(near(tg.x + tg.width + 3.5, (g.tg.right + g.or.left) / 2), `右鄰項(上一層之兄弟): 亦夾, 框線中心在間隙正中(實得 ${tg.x + tg.width + 3.5}, 應 ${(g.tg.right + g.or.left) / 2})`)
    })

    it('waitAlertGone: 等 domAlert 提示浮窗(id 以 alt- 開頭)全部消失; 逾時拋錯(含仍在之浮窗數); 無浮窗立即通過; 參數檢查', async function() {
        //浮窗 400ms 後移除: 等到消失才 resolve
        await page.setContent(`<div id="inline">Can not get the url</div><div id="alt-abc" style="position:fixed;top:10px;right:10px">Can not get the url</div>`)
        await page.evaluate(() => setTimeout(() => document.getElementById('alt-abc').remove(), 400))
        let t0 = Date.now()
        await waitAlertGone(page, { timeout: 5000 })
        let dt = Date.now() - t0
        assert.ok(dt >= 300, `應等到浮窗移除(實得 ${dt}ms)`)
        assert.strict.equal(await page.evaluate(() => document.querySelectorAll('[id^="alt-"]').length), 0)
        //無浮窗: 立即通過
        t0 = Date.now()
        await waitAlertGone(page, { timeout: 5000 })
        assert.ok(Date.now() - t0 < 1000, '無浮窗應立即通過')
        //逾時: 拋錯含仍在之浮窗數
        await page.setContent(`<div id="alt-x1">a</div><div id="alt-x2">b</div>`)
        await assert.rejects(waitAlertGone(page, { timeout: 300 }), /300ms 內提示浮窗未消失\(仍有 2 個/)
        await assert.rejects(waitAlertGone(page, { sel: '' }), /sel 須為非空之選擇器字串/)
    })

    it('captureStableWithBox 捲入: 目標比可視區大且已部分入鏡 → 預設仍捲入並告警 [box-scroll]; scrollTall:false 與 itemsUnionBox(loc,{scroll:null}) 皆不捲動(框可見部分)', async function() {
        //捲動容器 300px 高內有分頁列(40px) + 高 600px 之檢視面板(已部分入鏡): 捲入會把分頁列捲出(w-web-api display E2E-007 殷鑑)
        let html = `<div id="sc" style="position:absolute;left:20px;top:20px;width:500px;height:300px;overflow:auto;font:14px sans-serif">
            <div style="height:40px;background:#eef">Docs | Edit | Test</div>
            <div id="view" style="height:600px;background:#fff;border:1px solid #999">test view</div></div>`
        let logs = []
        let orig = console.log
        let scrollTopAfter = async (fn) => {
            await page.setContent(html)
            logs = []
            console.log = (...a) => {
                logs.push(a.join(' '))
            }
            try {
                await fn()
            }
            finally {
                console.log = orig
            }
            return page.evaluate(() => document.getElementById('sc').scrollTop)
        }
        let st1 = await scrollTopAfter(() => captureStableWithBox(page, page.locator('#view'), fast))
        assert.ok(st1 > 0, `預設: 仍捲入(向後相容), scrollTop=${st1}`)
        assert.ok(logs.some((l) => l.includes('[box-scroll]')), '預設: 印 [box-scroll] 告警')
        let st2 = await scrollTopAfter(() => captureStableWithBox(page, page.locator('#view'), { ...fast, scrollTall: false }))
        assert.strict.equal(st2, 0, 'scrollTall:false: 不捲動')
        let st3 = await scrollTopAfter(() => captureStableWithBox(page, itemsUnionBox(page.locator('#view'), { scroll: null }), fast))
        assert.strict.equal(st3, 0, 'itemsUnionBox(loc,{scroll:null}): 不捲動')
        //完整入鏡之小目標不告警
        let st4 = await scrollTopAfter(() => captureStableWithBox(page, page.locator('#sc > div').first(), fast))
        assert.ok(st4 === 0 && !logs.some((l) => l.includes('[box-scroll]')), '小目標已完整入鏡: 不捲不告警')
    })

    it('canvasInkRects: 圖表回報之寬鬆矩形收斂到實際墨跡(左右); 未繪製區回 null; 指定 canvas 與命中測試同果; 高 DPI 座標正確; 不透明背景以色差判定; 與 inkRect neighbors 併用時框線置於墨跡間隙正中', async function() {
        //畫布 CSS 400×100 於 (50,60)，實際 800×200(DPR 2)：項目一 = 方塊(20..30) + 方塊(40..70)，項目二 = 方塊(82..112)，皆 y 40..60(CSS)；兩項墨跡間隙 12px
        await page.setContent(`<canvas id="cv" width="800" height="200" style="position:absolute;left:50px;top:60px;width:400px;height:100px"></canvas>
            <canvas id="cv2" width="200" height="100" style="position:absolute;left:50px;top:200px;width:200px;height:100px"></canvas>`)
        await page.evaluate(() => {
            let c = document.getElementById('cv').getContext('2d')
            c.fillStyle = '#333'
            c.fillRect(40, 80, 20, 40) //CSS x 20..30
            c.fillRect(80, 80, 60, 40) //CSS x 40..70
            c.fillRect(164, 80, 60, 40) //CSS x 82..112
            let c2 = document.getElementById('cv2').getContext('2d')
            c2.fillStyle = '#fafafa'
            c2.fillRect(0, 0, 200, 100) //不透明背景
            c2.fillStyle = '#e00'
            c2.fillRect(30, 20, 40, 30) //CSS x 30..70, y 20..50
        })
        //寬鬆矩形(模擬圖表回報：項目一右緣比墨跡多 4px、左緣少 3px；項目二右緣多 4px)
        let loose1 = { x: 50 + 17, y: 60 + 38, width: 57, height: 24 } //CSS 17..74
        let loose2 = { x: 50 + 82, y: 60 + 38, width: 34, height: 24 } //CSS 82..116
        let empty = { x: 50 + 200, y: 60 + 38, width: 50, height: 24 } //未繪製
        let [a, b, c] = await canvasInkRects(page, [loose1, loose2, empty])
        assert.strict.deepStrictEqual([a.x, a.width, a.y, a.height], [50 + 20, 50, loose1.y, loose1.height], '項目一: 左右收斂到墨跡 20..70, 上下沿用原矩形')
        assert.strict.deepStrictEqual([b.x, b.width], [50 + 82, 30], '項目二: 82..112')
        assert.strict.equal(c, null, '未繪製區: null')
        let byCanvas = await canvasInkRects(page, [loose1], { canvas: '#cv' })
        assert.strict.deepStrictEqual(byCanvas[0], a, '指定 canvas 與命中測試同果')
        let ty = await canvasInkRects(page, [loose1], { trimY: true })
        assert.strict.deepStrictEqual([ty[0].y, ty[0].height], [60 + 40, 20], 'trimY: 上下亦收斂(40..60)')
        //不透明背景: 以 alpha 判定整塊皆為墨跡; 給 bg 後以色差判定
        let r2 = { x: 50 + 10, y: 200 + 10, width: 80, height: 50 }
        let [noBg] = await canvasInkRects(page, [r2])
        assert.strict.deepStrictEqual([noBg.x, noBg.width], [50 + 10, 80], '不透明背景未給 bg: 整塊皆算(提示須給 bg)')
        let [withBg] = await canvasInkRects(page, [r2], { bg: [250, 250, 250] })
        assert.strict.deepStrictEqual([withBg.x, withBg.width], [50 + 30, 40], '給 bg: 以色差判定, 收斂到紅塊 30..70')
        //與 inkRect 併用(框線中心 = 矩形右緣 + 3.5): 以寬鬆矩形取中點 → 中心在 (74 + 82) / 2 = 78, 距鄰項墨跡 82 只剩 1.5px(偏);
        //收斂到墨跡後 → 中心在墨跡間隙 70..82 之正中 76, 兩側各 3.5px
        let biased = inkRect(loose1, { neighbors: [loose2] })
        assert.strict.equal(biased.x + biased.width + 3.5, 50 + 78, '寬鬆矩形: 框線中心偏向鄰項')
        let box = inkRect(a, { neighbors: [b] })
        assert.strict.equal(box.x + box.width + 3.5, 50 + 76, '收斂到墨跡: 框線中心在墨跡間隙正中')
        //參數檢查
        await assert.rejects(canvasInkRects(page, [{ x: 1 }]), /rects 須為/)
        await assert.rejects(canvasInkRects(page, [loose1], { alpha: 300 }), /alpha 須為/)
        await assert.rejects(canvasInkRects(page, [loose1], { bg: [1, 2] }), /bg 須為/)
        await assert.rejects(canvasInkRects(page, [loose1], { canvas: '#nope' }), /找不到指定之 canvas/)
    })

    it('itemsUnionBox 接受 Locator(與選擇器同一量測); 紅框內緣與墨跡留白 = inkPad + pad(6) - 描邊(5) = 5px', async function() {
        await page.setContent(`<div style="position:absolute;left:0;top:0;width:800px;height:600px;display:flex;align-items:center;justify-content:center">
            <div style="width:100px;height:100px;background:#ddd"></div>
            <div style="margin-left:40px"><div id="msg" style="color:#aaa;font:16px sans-serif">Connecting...</div></div>
          </div>`)
        let bySel = await itemsUnionBox('#msg', { fit: true }).measure(page)
        let byLoc = await itemsUnionBox(page.getByText('Connecting...').first(), { fit: true }).measure(page)
        assert.strict.deepStrictEqual(byLoc, bySel, 'Locator 與選擇器量得相同')
        assert.throws(() => itemsUnionBox({}), /itemSel 須為非空之選擇器字串、其陣列或 Locator/)
        let m = itemsUnionBox(page.getByText('Connecting...').first(), { fit: true })
        assert.ok(m.scroll && typeof m.scroll.evaluateAll === 'function', '未給 within: 捲該 Locator')
        let buf = await captureStableWithBox(page, m, fast)
        let b = await redBBox(buf)
        let ink = await page.evaluate(() => {
            let rg = document.createRange()
            rg.selectNodeContents(document.getElementById('msg'))
            let r = rg.getBoundingClientRect()
            return { l: r.left, t: r.top, r: r.right, b: r.bottom }
        })
        //紅框外接 = 墨跡 ±(4+6), 描邊 5px 內縮 → 內緣與墨跡相距 5px(composeBox 不取整, 純色像素邊界容差 1px)
        let want = [ink.l - 10, ink.t - 10, ink.r + 10, ink.b + 10]
        let got = [b.x0, b.y0, b.x1 + 1, b.y1 + 1]
        got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 1, `紅框第 ${i} 邊 ${v} 應距 ${want[i]} ≤1px(全部: ${JSON.stringify(got)} vs ${JSON.stringify(want)})`))
    })

    it('被蓋住檢查: 目標在彈窗遮罩下 → 拋錯; warn 模式只告警; 框蓋在上面之面板、pointer-events:none 之目標、off 模式皆不拋', async function() {
        await page.setContent(`<div id="card" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#eee">card<span id="pe" style="pointer-events:none">x</span></div>
            <div id="shield" style="position:fixed;left:0;top:0;width:100vw;height:100vh;overscroll-behavior:none;background:rgba(0,0,0,.3)">
              <div id="panel" style="position:absolute;left:400px;top:100px;width:200px;height:120px;background:#fff">Deleted</div>
            </div>`)
        await assert.rejects(() => captureStableWithBox(page, '#card', fast), /紅框目標被其他元素蓋住.*#card 之中心被 div\(彈窗遮罩層內\)/)
        await assert.rejects(() => captureStableWithBox(page, page.locator('#card'), fast), /Locator 之中心被/)
        //量測型目標帶 probe(itemsUnionBox 包住單一 Locator)者照常檢查
        await assert.rejects(() => captureStableWithBox(page, itemsUnionBox(page.locator('#card'), { fit: true }), fast), /Locator 之中心被 div\(彈窗遮罩層內\)/)
        let warned = []
        let orig = console.warn
        console.warn = (m) => warned.push(String(m))
        try {
            let b = await captureStableWithBox(page, '#card', { ...fast, coverCheck: 'warn' })
            assert.ok(Buffer.isBuffer(b))
        }
        finally {
            console.warn = orig
        }
        assert.strict.equal(warned.length, 1)
        assert.ok(warned[0].startsWith('[box-covered] '))
        assert.ok(Buffer.isBuffer(await captureStableWithBox(page, '#panel', fast)), '框蓋在上面之面板不應拋錯')
        assert.ok(Buffer.isBuffer(await captureStableWithBox(page, '#card', { ...fast, coverCheck: 'off' })))
        //移除遮罩後: pointer-events:none 之目標命中其祖先(非被蓋住)
        await page.evaluate(() => document.getElementById('shield').remove())
        assert.ok(Buffer.isBuffer(await captureStableWithBox(page, '#pe', fast)), 'pointer-events:none 目標之命中為其祖先, 不算被蓋住')
        //環境變數覆寫預設
        let prev = process.env.E2E_COVER_CHECK
        process.env.E2E_COVER_CHECK = 'off'
        try {
            await page.evaluate(() => {
                let s = document.createElement('div')
                s.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,.3)'
                document.body.appendChild(s)
            })
            assert.ok(Buffer.isBuffer(await captureStableWithBox(page, '#card', fast)), 'E2E_COVER_CHECK=off 時不檢查')
        }
        finally {
            if (prev === undefined) delete process.env.E2E_COVER_CHECK
            else process.env.E2E_COVER_CHECK = prev
        }
    })

    it('captureStableWithBox + 量測型目標: 紅框外接矩形 = 量測矩形外擴 pad(6), 且於捲入之後才量', async function() {
        await page.setContent(`<div style="height:1500px"></div>
            <div id="grp" style="margin-left:100px;width:400px">
              <div class="row" style="height:30px">1</div><div class="row" style="height:30px">2</div>
            </div><div style="height:800px"></div>`)
        let m = itemsUnionBox('.row', { within: '#grp' })
        let buf = await captureStableWithBox(page, m, fast)
        let geo = await page.evaluate(() => {
            let r = document.getElementById('grp').getBoundingClientRect()
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, sy: window.scrollY }
        })
        assert.strict.ok(geo.sy > 0, '應已捲入(scroll 預設取 within)')
        let b = await redBBox(buf)
        assert.strict.deepStrictEqual([b.x0, b.y0, b.x1 + 1, b.y1 + 1], [geo.x - 6, geo.y - 6, geo.x + geo.w + 6, geo.y + geo.h + 6])
        //量測型目標與其他目標取聯集
        let buf2 = await captureStableWithBox(page, [m, { x: 10, y: 10, width: 20, height: 20 }], fast)
        assert.strict.ok(!buf2.equals(buf))
    })

})
