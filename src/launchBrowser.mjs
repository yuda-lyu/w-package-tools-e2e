import wpw from 'w-playwright'
import chromiumLaunchArgs from './chromiumLaunchArgs.mjs'


/**
 * 以確定性渲染旗標啟動無頭Chromium，為e2e測試端、標準圖產製端與探測腳本之唯一啟動出口
 *
 * 經自有套件w-playwright啟動(wpw.launchChromium)，不直接使用playwright：預設為無頭並帶chromiumLaunchArgs六旗標，opt.args另附加於六旗標之後，
 * 並帶autoInstall與installDeps(受管瀏覽器缺檔時安裝一次再啟動，Linux缺系統相依時安裝相依；兩者給布林值可覆寫，非布林值改用預設true)；其餘鍵原樣交給wpw.launchChromium(亦可給其debug、funLog、onTrace)。
 * w-playwright於args之末合併唯一之--disable-features(Playwright預設＋AutofillAiWalletPrivatePasses＋呼叫端自給者)，
 * 停用AutofillAiWalletPrivatePasses使Windows上Chromium 153起之瀏覽器不再以無效密碼替目前使用者呼叫LogonUser(錯誤密碼次數累計將鎖定帳號)。
 * opt.args任一元素無效(如不以-開頭)或連同六旗標逾10000項時w-playwright視整個args為[](六旗標一併失去，只留守門之一串)，故只給合法旗標。
 * 啟動與安裝之失敗reject w-playwright之固定詞彙錯誤(帶code，如E_LAUNCH、E_BROWSER_MISSING、E_INSTALL、E_ENV)，不附Playwright原錯誤(原錯誤只交opt.funLog)；
 * opt須為物件(null於讀opt.args時即reject原生TypeError，與改版前相同)
 *
 * @param {Object} [opt={}] 輸入wpw.launchChromium(即Playwright chromium.launch加w-playwright自用鍵)之設定物件，預設{}
 * @param {Boolean} [opt.headless=true] 輸入是否無頭布林值，預設true(無頭且未給channel時為Playwright受管之headless shell)
 * @param {Array} [opt.args=[]] 輸入附加於六旗標後之旗標字串陣列，非陣列時忽略，預設[]
 * @param {Boolean} [opt.autoInstall=true] 輸入受管瀏覽器缺檔時是否安裝一次再啟動布林值，非布林值時用預設，預設true
 * @param {Boolean} [opt.installDeps=true] 輸入Linux缺系統相依時是否安裝相依布林值(安裝子行程不接主控台輸入，須互動輸入密碼之sudo會失敗)，非布林值時用預設，預設true
 * @returns {Promise} 回傳Promise，resolve回傳Browser，reject回傳帶code之錯誤
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
    let o = { headless: true, autoInstall: true, installDeps: true, ...opt, args: [...chromiumLaunchArgs, ...extra] }

    //autoInstall、installDeps: 非布林值(含undefined、null)視為未給、改用本函數之預設true(輸入參數檢測K3), 不交由w-playwright之預設false
    if (typeof o.autoInstall !== 'boolean') {
        o.autoInstall = true
    }
    if (typeof o.installDeps !== 'boolean') {
        o.installDeps = true
    }

    return wpw.launchChromium(o)
}


export default launchBrowser
