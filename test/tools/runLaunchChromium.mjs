import launchChromium from '../../src/launchChromium.mjs'


//runLaunchChromium, 供e2e-launchChromium以子程序執行(各自之PLAYWRIGHT_BROWSERS_PATH), 啟動後開一頁並量測, 最後一行輸出JSON結果
//  用法 node test/tools/runLaunchChromium.mjs

let browser = null
try {
    browser = await launchChromium({ headless: true })
    let page = await browser.newPage()
    await page.setContent('<div id="a" style="width:120px; height:30px;">ok</div>')
    let width = await page.evaluate(() => document.getElementById('a').offsetWidth)
    console.log('RESULT ' + JSON.stringify({ version: browser.version(), width }))
}
catch (err) {
    console.log('ERROR ' + String(err && err.message).split('\n')[0])
    process.exitCode = 1
}
finally {
    if (browser) {
        await browser.close()
    }
}
