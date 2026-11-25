import wpw from 'w-playwright'
import chromiumLaunchArgs from './chromiumLaunchArgs.mjs'


//reLangStr, 語系字串之語法(同w-playwright之判準: 2~3字母之語言碼加以-相接之1~8字英數子標籤, 單一語系, 總長至多35)
let reLangStr = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/


//isLangStr, 是否為w-playwright採用之語系字串(opt.lang之有效值)
function isLangStr(v) {
    return typeof v === 'string' && v.length <= 35 && reLangStr.test(v)
}


//isLangSwitch, 是否為語系開關(同w-playwright之辨識: 去前置-、不分大小寫、取=之前為lang; 含--lang=xx、-lang=xx、--LANG=xx、--lang、--lang=)
function isLangSwitch(a) {
    return typeof a === 'string' && /^-+lang(?:=|$)/i.test(a)
}


/**
 * 以確定性渲染旗標啟動無頭Chromium，為e2e測試端、標準圖產製端與探測腳本之唯一啟動出口
 *
 * 經自有套件w-playwright啟動(wpw.launchChromium)，不直接使用playwright：預設為無頭並帶chromiumLaunchArgs八旗標(六旗標＋--lang=zh-TW＋--disable-smooth-scrolling)，opt.args另附加於八旗標之後，
 * 並帶autoInstall與installDeps(受管瀏覽器缺檔時安裝一次再啟動，Linux缺系統相依時安裝相依；兩者給布林值可覆寫，非布林值改用預設true)；其餘鍵原樣交給wpw.launchChromium(亦可給其debug、funLog、onTrace)。
 * w-playwright於args之末合併唯一之--disable-features(Playwright預設＋AutofillAiWalletPrivatePasses＋呼叫端自給者)，
 * 停用AutofillAiWalletPrivatePasses使Windows上Chromium 153起之瀏覽器不再以無效密碼替目前使用者呼叫LogonUser(錯誤密碼次數累計將鎖定帳號)。
 * opt.args任一元素無效(如不以-開頭)或連同旗標組逾10000項時w-playwright視整個args為[](旗標組一併失去，含--lang=zh-TW，只留守門之一串與w-playwright補入之主機語系)，故只給合法旗標。
 * 語系：預設以--lang=zh-TW固定應用程式語系(Chromium 159起不再繼承主機系統語系，字型隨語系而變，見chromiumLaunchArgs)，不隨執行機器之系統語系而變；
 * 另以--disable-smooth-scrolling關閉平滑捲動(鍵盤與滾輪之捲動即時到位，不因動畫相位而時序競賽)；呼叫端欲開平滑捲動者於opt.args另給--enable-smooth-scrolling(附加於旗標組之後，實測可開啟，見e2e-launchBrowserScroll [SS02])。
 * 呼叫端自給語系者(opt.args含語系開關，如--lang=en-US、-lang=en-US、--LANG=en-US、--lang；或opt.lang為語系字串或false)以呼叫端者為準，launchBrowser不帶旗標組之--lang，
 * 故最終命令列之語系開關恰為呼叫端所給者(opt.args與opt.lang並存時以opt.args為準，opt.lang被w-playwright忽略；opt.lang為false則不帶任何--lang)；opt.lang為無效值時視為未給，仍用zh-TW。
 * 啟動與安裝之失敗reject w-playwright之固定詞彙錯誤(帶code，如E_LAUNCH、E_BROWSER_MISSING、E_INSTALL、E_ENV)，不附Playwright原錯誤(原錯誤只交opt.funLog)；
 * opt須為物件(null於讀opt.args時即reject原生TypeError，與改版前相同)
 *
 * @param {Object} [opt={}] 輸入wpw.launchChromium(即Playwright chromium.launch加w-playwright自用鍵)之設定物件，預設{}
 * @param {Boolean} [opt.headless=true] 輸入是否無頭布林值，預設true(無頭且未給channel時為Playwright受管之headless shell)
 * @param {Array} [opt.args=[]] 輸入附加於旗標組(八旗標)後之旗標字串陣列，非陣列時忽略；含語系開關時不帶旗標組之--lang，預設[]
 * @param {String|Boolean} [opt.lang] 輸入啟動語系(語系字串如'en-US'，或false表不帶任何--lang)，由w-playwright處理；有效值時launchBrowser不帶旗標組之--lang，無效值視為未給，預設未給(用zh-TW)
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

    //語系: 呼叫端自給(opt.args含語系開關、opt.lang為false或有效語系字串)者以呼叫端為準, 旗標組之--lang不帶, 使最終命令列之語系開關不重複(w-playwright對args內兩個--lang原樣保留為兩個, opt.lang於args已有語系開關時被忽略)
    let callerLang = extra.some(isLangSwitch) || opt.lang === false || isLangStr(opt.lang)
    let base = callerLang ? chromiumLaunchArgs.filter((a) => !isLangSwitch(a)) : chromiumLaunchArgs
    let o = { headless: true, autoInstall: true, installDeps: true, ...opt, args: [...base, ...extra] }

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
