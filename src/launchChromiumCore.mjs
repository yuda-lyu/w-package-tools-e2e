/**
 * 啟動瀏覽器之核心流程，缺少Playwright所需版本之瀏覽器時先安裝再啟動，Linux缺少系統相依套件時先安裝相依再啟動
 *
 * 依賴以參數注入，供單元測試模擬各種失敗情形，實際使用請呼叫launchChromium
 *
 * 僅在使用Playwright管理之瀏覽器時自動安裝(未指定executablePath，且channel為空或'chromium')，
 * 指定系統瀏覽器(channel如'chrome')或自訂執行檔時不安裝，錯誤直接拋出
 *
 * 各補救措施(安裝瀏覽器、安裝系統相依)至多各執行一次，補救後仍失敗則拋出錯誤
 *
 * @param {Object} [opt={}] 輸入chromium.launch之設定物件，預設{}
 * @param {Object} deps 輸入依賴物件
 * @param {Function} deps.launch 輸入啟動函數，傳入opt，回傳Promise
 * @param {Function} deps.runCli 輸入執行Playwright CLI函數，傳入參數陣列，回傳Promise
 * @param {String} deps.platform 輸入作業系統字串，同process.platform
 * @returns {Promise} 回傳Promise，resolve回傳deps.launch之結果，reject回傳錯誤
 */
async function launchChromiumCore(opt = {}, deps = {}) {
    let { launch, runCli, platform } = deps

    //managed, 未指定executablePath且channel為空或'chromium'者為Playwright管理之瀏覽器, 才可自動安裝
    let channel = opt.channel
    let managed = !opt.executablePath && (!channel || channel === 'chromium')

    //installArgs, 無頭(且非channel:'chromium')使用headless shell, 只需安裝headless shell; 有頭或channel:'chromium'使用完整chromium
    let useShell = opt.headless !== false && channel !== 'chromium'
    let installArgs = ['install', useShell ? '--only-shell' : '--no-shell', 'chromium']

    let installedBrowser = false
    let installedDeps = false
    while (true) {
        try {
            return await launch(opt)
        }
        catch (err) {
            let msg = String(err && err.message)

            //缺少瀏覽器執行檔, 為Playwright所需版本之瀏覽器尚未下載
            if (managed && !installedBrowser && /Executable doesn't exist at/.test(msg)) {
                installedBrowser = true
                await runCli(installArgs)
                continue
            }

            //Linux缺少系統相依套件, 非root時Playwright會自行使用sudo安裝
            if (managed && !installedDeps && platform === 'linux' && /Host system is missing dependencies|Missing system dependencies/.test(msg)) {
                installedDeps = true
                await runCli(['install-deps', 'chromium'])
                continue
            }

            throw err
        }
    }
}


export default launchChromiumCore
