import path from 'path'
import { createRequire } from 'module'
import { spawn } from 'child_process'
import { chromium } from 'playwright'
import launchChromiumCore from './launchChromiumCore.mjs'


let require = createRequire(import.meta.url)


function runCli(args) {
    //以此處解析之playwright(與上方import同一份)之CLI執行, 下載之瀏覽器即為該版Playwright所需版本
    //以process.execPath(正在執行之node)執行, 不依賴npx與PATH; playwright/cli.js未列於exports, 故由package.json位置與bin組出路徑
    let fpPkg = require.resolve('playwright/package.json')
    let pkg = require(fpPkg)
    let fpCli = path.join(path.dirname(fpPkg), pkg.bin.playwright)

    //非同步執行, 下載期間不阻塞呼叫端之事件迴圈(例如同程序內其他子程序之輸出)
    return new Promise((resolve, reject) => {
        let cp = spawn(process.execPath, [fpCli, ...args], { stdio: 'inherit' })
        cp.on('error', reject)
        cp.on('close', (code) => {
            if (code === 0) {
                resolve()
            }
            else {
                reject(new Error(`playwright ${args.join(' ')} failed with exit code ${code}`))
            }
        })
    })
}


/**
 * 啟動Playwright之Chromium，所需版本之瀏覽器不存在時先自動下載再啟動
 *
 * 不使用套件安裝腳本(npm 12起預設略過相依套件之install/postinstall)，改於第一次啟動時以Playwright自身之CLI下載，
 * 下載之瀏覽器為本套件所用Playwright版本指定之版本，與本機已安裝者相同，像素比對得以一致
 *
 * Linux缺少系統相依套件時先執行install-deps(非root時Playwright會自行使用sudo)再啟動；
 * 指定系統瀏覽器(channel如'chrome')或自訂executablePath時不自動安裝
 *
 * 多個程序同時首次啟動時，Playwright安裝過程有目錄鎖，只會下載一次，其餘等待後直接使用
 *
 * @param {Object} [opt={}] 輸入chromium.launch之設定物件，原樣傳入，預設{}
 * @returns {Promise} 回傳Promise，resolve回傳Browser，reject回傳錯誤
 * @example
 *
 * import launchChromium from 'w-package-tools-e2e/src/launchChromium.mjs'
 *
 * let browser = await launchChromium({ headless: true, args: ['--disable-gpu'] })
 * let page = await browser.newPage()
 * await page.goto('http://127.0.0.1:8080')
 * await browser.close()
 *
 */
async function launchChromium(opt = {}) {
    return launchChromiumCore(opt, {
        launch: (o) => chromium.launch(o),
        runCli,
        platform: process.platform,
    })
}


export default launchChromium
