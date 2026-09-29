import launchChromium from './launchChromium.mjs'
import chromiumLaunchArgs from './chromiumLaunchArgs.mjs'


/**
 * 以確定性渲染旗標啟動無頭Chromium，為e2e測試端、標準圖產製端與探測腳本之唯一啟動出口
 *
 * 預設為無頭並帶chromiumLaunchArgs六旗標；opt.args另附加於六旗標之後，其餘鍵原樣傳給launchChromium(即chromium.launch)。
 * 所需版本之瀏覽器不存在時由launchChromium先行下載
 *
 * @param {Object} [opt={}] 輸入chromium.launch之設定物件，預設{}
 * @param {Boolean} [opt.headless=true] 輸入是否無頭布林值，預設true
 * @param {Array} [opt.args=[]] 輸入附加於六旗標後之旗標字串陣列，預設[]
 * @returns {Promise} 回傳Promise，resolve回傳Browser，reject回傳錯誤
 * @example
 *
 * import launchBrowser from 'w-package-tools-e2e/src/launchBrowser.mjs'
 *
 * let browser = await launchBrowser()
 * let page = await browser.newPage()
 * await page.goto('http://127.0.0.1:8080')
 * await browser.close()
 *
 */
async function launchBrowser(opt = {}) {
    let extra = Array.isArray(opt.args) ? opt.args : []
    return launchChromium({ headless: true, ...opt, args: [...chromiumLaunchArgs, ...extra] })
}


export default launchBrowser
