import launchBrowser from '../../src/launchBrowser.mjs'


//launchBrowserCmdline, 供 api-launchBrowserWiring 之 [LB07] 以子行程執行: 不掛替身, 經 launchBrowser(w-playwright)真啟動預設之 headless shell,
//收 Playwright 之 <launching> 紀錄(實際執行檔與參數; playwright-core 之 debugLogger 於環境變數 DEBUG=pw:browser 時寫至 stderr, 須在載入 playwright-core 前設定, 故由父測試以子行程之環境給定)
//(Playwright 之 logger 選項收不到此紀錄; CDP Browser.getBrowserCommandLine 須 --enable-automation, headless shell 回錯誤)
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


let r = { ok: false, launching: [], text: '', code: '', message: '' }
let browser = null
try {
    browser = await launchBrowser()
    let page = await browser.newPage()
    await page.setContent('<div id="x">ok</div>')
    r.text = await page.textContent('#x')
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
