/**
 * 測試行程端之偵測驅動等待：反覆執行判斷函數直到回傳truthy，逾時即拋錯(代表真實異常，而非固定等待不夠)
 *
 * 用於等待瀏覽器外之非同步結果——後端週期計時器寫入資料庫(封鎖、補登記)、背景程序產檔、日誌出現某行——
 * 取代「固定等N秒再讀」：計時器於負載高時延遲，固定秒數只在一台機器、一種負載下成立(2026-09-28 w-web-sso autoblock
 * 以固定3秒等2秒週期計時器殷鑑)。與waitUntilExist分工：waitUntilExist之fn於瀏覽器頁面內執行(DOM、localStorage)，
 * 本函數之fn於測試行程執行(資料庫、檔案系統、HTTP)，可使用閉包。
 * fn拋錯視為「尚未成立」並繼續輪詢(例如查詢之紀錄尚不存在而取值失敗)，逾時訊息附最後一次錯誤。
 *
 * @param {String} label 輸入錯誤訊息用之對象描述字串
 * @param {Function} fn 輸入判斷函數，可為async函數，回傳truthy代表成立
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeout=30000] 輸入逾時毫秒數，預設30000
 * @param {Number} [opt.interval=200] 輸入輪詢間隔毫秒數，預設200
 * @returns {Promise} 回傳Promise，resolve為fn最後一次之truthy回傳值，逾時reject
 * @example
 *
 * import pollUntil from 'w-package-tools-e2e/src/pollUntil.mjs'
 *
 * //等後端計時器把新IP補登記進ips表, 回傳查得之紀錄
 * let ips = await pollUntil('ips 補登記', async () => {
 *     let rs = await woItems.ips.select({ ip })
 *     return rs.length > 0 ? rs : null
 * }, { timeout: 60000 })
 *
 */
async function pollUntil(label, fn, opt = {}) {
    let { timeout = 30000, interval = 200 } = opt
    if (typeof label !== 'string' || label === '') {
        throw new Error('pollUntil: label 須為非空字串')
    }
    if (typeof fn !== 'function') {
        throw new Error('pollUntil: fn 須為函數')
    }
    if (!(typeof timeout === 'number' && timeout > 0)) {
        throw new Error('pollUntil: timeout 須為正數')
    }
    if (!(typeof interval === 'number' && interval > 0)) {
        throw new Error('pollUntil: interval 須為正數')
    }
    let deadline = Date.now() + timeout
    let lastErr = null
    let n = 0
    for (;;) {
        n++
        try {
            let v = await fn()
            if (v) {
                return v
            }
        }
        catch (err) {
            lastErr = err
        }
        //至少判斷一次; 逾時後不再睡
        if (Date.now() >= deadline) {
            break
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))))
    }
    let tail = lastErr ? `；最後一次判斷拋錯: ${lastErr && lastErr.message ? lastErr.message : String(lastErr)}` : ''
    throw new Error(`pollUntil 超過 ${timeout}ms(判斷 ${n} 次)條件仍不成立「${label}」${tail} — 此為真實異常 (計時器未執行 / 寫入失敗)`)
}


export default pollUntil
