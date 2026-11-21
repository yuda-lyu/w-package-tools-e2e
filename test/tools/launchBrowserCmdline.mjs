import launchBrowser from '../../src/launchBrowser.mjs'
import withHostLang from './withHostLang.mjs'


//launchBrowserCmdline, 供 api-launchBrowserWiring 之 [LB07]、[LB07c] 以子行程執行: 不掛替身, 經 launchBrowser(w-playwright)真啟動預設之 headless shell,
//收 Playwright 之 <launching> 紀錄(實際執行檔與參數; playwright-core 之 debugLogger 於環境變數 DEBUG=pw:browser 時寫至 stderr, 須在載入 playwright-core 前設定, 故由父測試以子行程之環境給定)
//(Playwright 之 logger 選項收不到此紀錄; CDP Browser.getBrowserCommandLine 須 --enable-automation, headless shell 回錯誤)
//第一個命令列參數(選填)為 JSON 字串, 解析後作為 launchBrowser 之 opt(如 {"args":["--lang=en-US"]}); 未給則不帶 opt
//第二個命令列參數(選填)為模擬之主機系統語系(如 en-US): 以 withHostLang 替身使 w-playwright 取得該語系, 不隨執行機器之實際系統語系而變; 未給則用實際主機語系
//最後一行輸出 'RESULT <json>'


let launching = []
let stderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = (chunk, ...rest) => {
    let s = String(chunk)
    let i = s.indexOf('<launching> ')
    if (i >= 0) {
        launching.push(s.slice(i + 12).trim())
    }
    return stderrWrite(chunk, ...rest)
}


let r = { ok: false, launching: [], text: '', lang: '', code: '', message: '' }
let browser = null
try {
    let optJson = process.argv[2]
    let opt = typeof optJson === 'string' && optJson !== '' ? JSON.parse(optJson) : undefined
    let hostLang = process.argv[3]
    if (typeof hostLang === 'string' && hostLang !== '') {
        browser = await withHostLang(hostLang, () => launchBrowser(opt))
    }
    else {
        browser = await launchBrowser(opt)
    }
    let page = await browser.newPage()
    await page.setContent('<div id="x">ok</div>')
    r.text = await page.textContent('#x')
    r.lang = await page.evaluate(() => navigator.language)
    r.launching = launching.slice()
    r.ok = true
}
catch (err) {
    r.code = String(err && err.code)
    r.message = String(err && err.message)
}
finally {
    if (browser) {
        await browser.close()
    }
}
console.log('RESULT ' + JSON.stringify(r))
