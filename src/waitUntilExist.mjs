/**
 * 偵測驅動之等待：每步驟先偵測對象存在或就緒再進下一步，逾時即拋錯(代表真實異常，而非固定等待不夠)
 *
 * fn於瀏覽器端執行，跨行程序列化故不可使用閉包變數，傳值一律經opt.arg。
 * fn為async函數(例如頁面內fetch後端再判斷)時改為逐次page.evaluate並await其結果輪詢：Playwright之waitForFunction同步呼叫predicate，
 * async函數回傳之Promise為truthy而第一次即放行(不重試、逾時無效，條件不成立也照樣通過；2026-09-28查得共20處：
 * w-web-sso之ag-grid等待以async判斷直呼waitForFunction 14處、w-web-task以async判斷呼叫waitUntilExist 6處)
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {String} label 輸入錯誤訊息用之對象描述字串
 * @param {Function} fn 輸入於頁面執行之判斷函數，回傳truthy代表就緒；可為async函數
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeout=10000] 輸入逾時毫秒數，預設10000
 * @param {*} [opt.arg=null] 輸入傳給fn之參數，預設null
 * @param {Number} [opt.polling=100] 輸入async函數之輪詢間隔毫秒數，預設100
 * @returns {Promise} 回傳Promise，resolve代表就緒，逾時reject
 * @example
 *
 * import waitUntilExist from 'w-package-tools-e2e/src/waitUntilExist.mjs'
 *
 * await waitUntilExist(page, '表格列', () => document.querySelectorAll('.ag-row').length > 0)
 * await waitUntilExist(page, '訊息', (t) => document.body.innerText.includes(t), { arg: '儲存成功' })
 *
 */
async function waitUntilExist(page, label, fn, opt = {}) {
    let { timeout = 10000, arg = null, polling = 100 } = opt
    let fail = () => new Error(`waitUntilExist 超過 ${timeout}ms 仍找不到「${label}」 — 此為真實異常 (production race / 元件未渲染)`)
    if (typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncFunction') {
        let deadline = Date.now() + timeout
        while (Date.now() < deadline) {
            //evaluate會await fn回傳之Promise; 導頁中之評估失敗視為未就緒, 繼續輪詢
            let v = await page.evaluate(fn, arg).catch(() => false)
            if (v) {
                return
            }
            await new Promise((resolve) => setTimeout(resolve, polling))
        }
        throw fail()
    }
    try {
        await page.waitForFunction(fn, arg, { timeout })
    }
    catch (err) {
        throw fail()
    }
}


export default waitUntilExist
