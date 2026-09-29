/**
 * 【w-component-vue】等WDrawer拖曳分隔條(cursor:col-resize)之覆蓋層opacity變為1
 *
 * 該覆蓋層之opacity由setTimeout(300ms)控制0到1，CPU忙時可能被延後超過初始等待，故於頁面內輪詢(每50ms)至全部為1；
 * 頁面無此元素時立即放行，逾時(預設5000ms)不拋錯
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeout=5000] 輸入逾時毫秒數，預設5000
 * @returns {Promise} 回傳Promise，resolve代表已就緒或已逾時
 * @example
 *
 * import waitColResizeOverlay from 'w-package-tools-e2e/src/waitColResizeOverlay.mjs'
 *
 * await waitColResizeOverlay(page)
 *
 */
async function waitColResizeOverlay(page, opt = {}) {
    let { timeout = 5000 } = opt
    await page.evaluate(async (t) => {
        let deadline = Date.now() + t
        while (Date.now() < deadline) {
            let bars = Array.from(document.querySelectorAll('[style*="cursor:col-resize"], [style*="cursor: col-resize"]'))
            if (bars.length === 0) return //無WDrawer, 直接過
            let allReady = bars.every((b) => parseFloat(getComputedStyle(b).opacity) === 1)
            if (allReady) return
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
    }, timeout)
}


export default waitColResizeOverlay
