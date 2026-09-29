/**
 * 【ag-grid】等表格靜止：以「內容簽章＋版面幾何」每intervalMs取樣一次，連續stableMs毫秒完全相同才放行
 *
 * 簽章：.ag-cell總數、指定列(rowIndex)各儲存格之欄位id與前30字、中央欄容器／標頭／首列之矩形、水平與垂直捲動量。
 * why：只看文字之簽章抓不到1px位移，兩次雙重requestAnimationFrame(約4個frame)之觀察窗太短，技能列為已驗證無效之手法；
 * 本函數取代各測試檔手寫之雙重rAF判斷。頁面無表格(.ag-center-cols-viewport)時立即放行，但minCells大於0時視為未就緒(等表格出現)；
 * requireSelector未出現、儲存格數少於minCells或(requireScrollLeftZero時)水平捲動量不為0之取樣視為未就緒並重新計時；逾時拋錯
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.stableMs=1000] 輸入須連續相同之毫秒數，預設1000
 * @param {Number} [opt.intervalMs=100] 輸入取樣間隔毫秒數，預設100
 * @param {Number} [opt.timeout=15000] 輸入逾時毫秒數，預設15000
 * @param {String} [opt.scope=''] 輸入限定範圍之選擇器前綴字串(例如對話框內之表格)，預設''
 * @param {String} [opt.requireSelector=null] 輸入須已出現之選擇器字串(例如某欄之標頭)，預設null
 * @param {Number} [opt.rowIndex=0] 輸入納入簽章之列row-index，預設0
 * @param {Number} [opt.minCells=0] 輸入至少須有之儲存格數，預設0；大於0時表格尚未出現亦視為未就緒
 * @param {Boolean} [opt.requireScrollLeftZero=false] 輸入是否要求水平捲動量為0布林值，預設false
 * @returns {Promise} 回傳Promise，resolve代表已靜止，逾時reject
 * @example
 *
 * import waitGridIdle from 'w-package-tools-e2e/src/waitGridIdle.mjs'
 *
 * await waitGridIdle(page, { requireSelector: '.ag-header-cell[col-id="token"]', requireScrollLeftZero: true })
 *
 */
async function waitGridIdle(page, opt = {}) {
    let {
        stableMs = 1000,
        intervalMs = 100,
        timeout = 15000,
        scope = '',
        requireSelector = null,
        rowIndex = 0,
        minCells = 0,
        requireScrollLeftZero = false,
    } = opt
    let ok = await page.evaluate(async (o) => {
        let sel = (s) => (o.scope ? `${o.scope} ${s}` : s)
        let rect = (e) => {
            if (!e) return ''
            let r = e.getBoundingClientRect()
            return `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`
        }
        //回傳 { skip } 代表頁面無表格; null 代表未就緒; { sig } 為簽章
        let sample = () => {
            let body = document.querySelector(sel('.ag-center-cols-viewport'))
            if (!body) return o.minCells > 0 ? null : { skip: true }
            if (o.requireSelector && !document.querySelector(o.requireSelector)) return null
            if (o.requireScrollLeftZero && body.scrollLeft !== 0) return null
            let cells = document.querySelectorAll(sel('.ag-cell'))
            if (cells.length < o.minCells) return null
            let row = Array.from(document.querySelectorAll(sel(`.ag-row[row-index="${o.rowIndex}"] .ag-cell`)))
            return {
                sig: JSON.stringify([
                    cells.length,
                    row.map((c) => `${c.getAttribute('col-id') || ''}:${(c.innerText || '').slice(0, 30)}`),
                    rect(document.querySelector(sel('.ag-center-cols-container'))),
                    rect(document.querySelector(sel('.ag-header'))),
                    rect(document.querySelector(sel('.ag-row'))),
                    body.scrollLeft,
                    body.scrollTop,
                ]),
            }
        }
        let deadline = Date.now() + o.timeout
        let prev = null
        let since = 0
        while (Date.now() < deadline) {
            let s = sample()
            if (s && s.skip) return true
            let now = Date.now()
            if (!s) {
                prev = null
            }
            else if (s.sig !== prev) {
                prev = s.sig
                since = now
            }
            else if (now - since >= o.stableMs) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, o.intervalMs))
        }
        return false
    }, { stableMs, intervalMs, timeout, scope, requireSelector, rowIndex, minCells, requireScrollLeftZero })
    if (!ok) {
        throw new Error(`waitGridIdle 超過 ${timeout}ms 表格仍未靜止${requireSelector ? ` (或未出現 ${requireSelector})` : ''}`)
    }
}


export default waitGridIdle
