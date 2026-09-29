/**
 * 為單一案例開新的瀏覽器context與頁面，並掛上對話框(alert/confirm/prompt)處理器
 *
 * 每案例fresh context，避免cookie、localStorage與快取跨案例殘留；contextOptions透傳給browser.newContext
 * (viewport、locale、timezoneId等確定性參數依專案給定，不給即沿用Playwright預設)
 *
 * @param {Browser} browser 輸入Playwright之Browser
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} [opt.contextOptions={}] 輸入browser.newContext之參數物件，預設{}
 * @param {String|Function|null} [opt.onDialog='accept'] 輸入對話框處理方式，'accept'自動接受、'dismiss'自動取消、函數則自行處理(傳入dialog)、null不掛，預設'accept'
 * @returns {Promise} 回傳Promise，resolve回傳Playwright之Page
 * @example
 *
 * import openCasePage from 'w-package-tools-e2e/src/openCasePage.mjs'
 *
 * let page = await openCasePage(browser)
 * let page2 = await openCasePage(browser, { contextOptions: { viewport: { width: 1440, height: 900 } } })
 *
 */
async function openCasePage(browser, opt = {}) {
    let { contextOptions = {}, onDialog = 'accept' } = opt
    let context = await browser.newContext(contextOptions)
    let page = await context.newPage()
    if (onDialog === 'accept') {
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })
    }
    else if (onDialog === 'dismiss') {
        page.on('dialog', async (dialog) => {
            await dialog.dismiss()
        })
    }
    else if (typeof onDialog === 'function') {
        page.on('dialog', onDialog)
    }
    return page
}


export default openCasePage
