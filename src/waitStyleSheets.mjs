/**
 * 截圖就緒條件之一：等頁面上之樣式表(<link rel=stylesheet>)載入完成，並回報仍未載入與載入失敗者(本函數不拋錯，由呼叫端決定)
 *
 * why(排程第 529 項，2026-11-24)：全庫連動高負載下，曾截到 CSS 未載入之素頁(按鈕為瀏覽器預設樣式)——
 * captureStable 之就緒條件(初始等待、settle、字型、連拍相同)皆不含「樣式表已載入」，未載入之素頁本身穩定，連拍相同即被回傳。
 * 動態插入之 <link>(非同步 chunk 之 CSS)不阻擋 load 與首次繪製；head 內之 <link> 於 page.goto 未等 load 時亦可能未完成。
 * 判定(Chromium 159 實測)：載入中之 <link> 其 sheet 為 null；載入完成者 sheet 非 null；**載入失敗(404、連線重設)者 sheet 亦非 null(空表)
 * 並已觸發 error**——故以「sheet 為 null」判定「載入中」並等待(load／error 事件，另每 200ms 重查以涵蓋等待中新插入者)；
 * 失敗者另以 Resource Timing 之 responseStatus(0 或 ≥ 400)判定，只判 http(s) 同源者(跨來源未帶 Timing-Allow-Origin 時 responseStatus 恆為 0，
 * file:、data: 等亦恆為 0，皆無從判定)；Resource Timing 緩衝已滿而查無紀錄者不判為失敗。
 * sheet 留為 null 之失敗(SRI 不符、CORS 被擋等)：等待中收到 error 者，或 Resource Timing 已有其紀錄(取回已結束)而 1 秒寬限後 sheet 仍為 null 者，
 * 判為失敗(不論來源)、不再等待(寬限為免把「已取回、剖析中」之大樣式表誤判)；等待開始前即已失敗而無 Resource Timing 紀錄者仍等到逾時(列為 pending)。
 * 不納入：disabled、rel 含 alternate、無 href 者；<style> 元素(內嵌，無需載入)。
 * 正常已載入之頁面：只多一次 page.evaluate，不等待、不改畫面。
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeout=30000] 輸入等待載入中樣式表之上限毫秒數，預設30000
 * @returns {Promise} 回傳Promise，resolve回傳{pending,failed,waitedMs}，pending為逾時仍載入中之href陣列，failed為同源而載入失敗之href陣列，waitedMs為等待毫秒數
 * @example
 *
 * import waitStyleSheets from 'w-package-tools-e2e/src/waitStyleSheets.mjs'
 *
 * let r = await waitStyleSheets(page, { timeout: 30000 })
 * if (r.pending.length > 0 || r.failed.length > 0) {
 *     throw new Error(`樣式表未就緒: ${JSON.stringify(r)}`)
 * }
 *
 */
async function waitStyleSheets(page, opt = {}) {
    let { timeout = 30000 } = opt
    if (!(typeof timeout === 'number' && timeout >= 0 && Number.isFinite(timeout))) {
        timeout = 30000
    }
    return await page.evaluate(async ({ timeoutMs, graceMs }) => {
        let t0 = performance.now()
        let links = () => Array.from(document.querySelectorAll('link[rel~="stylesheet" i]')).filter((l) => {
            return !l.disabled && !/(^|\s)alternate(\s|$)/i.test(l.rel || '') && !!l.getAttribute('href')
        })
        //sheet 為 null 而已結束者: 等待中收到 error(SRI 不符、CORS 被擋等 sheet 留為 null 者), 或 Resource Timing 已有紀錄(取回已結束)而寬限 graceMs 後仍為 null
        let errored = new WeakSet()
        let doneAt = new WeakMap()
        let isDeadNull = (l) => {
            if (errored.has(l)) {
                return true
            }
            let es = performance.getEntriesByName(l.href, 'resource')
            if (es.length === 0) {
                return false
            }
            if (!doneAt.has(l)) {
                doneAt.set(l, performance.now())
            }
            return performance.now() - doneAt.get(l) >= graceMs
        }
        let nullSheets = () => links().filter((l) => !l.sheet)
        let pend = () => nullSheets().filter((l) => !isDeadNull(l))
        for (;;) {
            let ls = pend()
            let left = timeoutMs - (performance.now() - t0)
            if (ls.length === 0 || left <= 0) {
                break
            }
            await new Promise((resolve) => {
                let h = null
                let onErr = (ev) => {
                    errored.add(ev.target)
                    done()
                }
                let done = () => {
                    clearTimeout(h)
                    ls.forEach((l) => {
                        l.removeEventListener('load', done)
                        l.removeEventListener('error', onErr)
                    })
                    resolve()
                }
                ls.forEach((l) => {
                    l.addEventListener('load', done)
                    l.addEventListener('error', onErr)
                })
                h = setTimeout(done, Math.min(200, left))
            })
        }
        //sheet 為 null 而已結束者為失敗(不論來源: 樣式表確定未套用)
        let failed = nullSheets().filter((l) => isDeadNull(l)).map((l) => l.href)
        for (let l of links()) {
            if (!l.sheet) {
                continue
            }
            let u = null
            try {
                u = new URL(l.href, location.href)
            }
            catch (err) {
                u = null
            }
            //只判 http(s) 同源者: file:、data: 等之 origin 為 'null' 而 responseStatus 恆為 0, 不可據以判定失敗
            if (!u || !/^https?:$/.test(u.protocol) || u.origin !== location.origin) {
                continue
            }
            let es = performance.getEntriesByName(u.href, 'resource')
            let e = es.length > 0 ? es[es.length - 1] : null
            if (e && typeof e.responseStatus === 'number' && (e.responseStatus === 0 || e.responseStatus >= 400)) {
                failed.push(l.href)
            }
        }
        return { pending: pend().map((l) => l.href), failed, waitedMs: Math.round(performance.now() - t0) }
    }, { timeoutMs: timeout, graceMs: 1000 })
}


export default waitStyleSheets
