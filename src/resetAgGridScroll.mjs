/**
 * 【ag-grid】把表格水平捲動歸零並稍候，使欄位重排(例如切換編輯模式)後之視圖確定
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.settleMs=300] 輸入歸零後等待毫秒數，預設300
 * @returns {Promise} 回傳Promise，頁面無ag-grid時亦正常resolve
 * @example
 *
 * import resetAgGridScroll from 'w-package-tools-e2e/src/resetAgGridScroll.mjs'
 *
 * await resetAgGridScroll(page)
 *
 */
async function resetAgGridScroll(page, opt = {}) {
    let { settleMs = 300 } = opt
    await page.evaluate(() => {
        document.querySelectorAll('.ag-body-horizontal-scroll-viewport, .ag-center-cols-viewport').forEach((e) => {
            e.scrollLeft = 0
        })
    }).catch(() => {})
    await page.waitForTimeout(settleMs)
}


export default resetAgGridScroll
