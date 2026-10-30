import execProcessPortPidsSync from 'wsemi/src/execProcessPortPidsSync.mjs'


/**
 * 查詢監聽指定port之PID(同步)
 *
 * 實際查詢委由wsemi之execProcessPortPidsSync：判定不依狀態欄，只看「本地埠相符、遠端為萬用位址且遠端埠0」之TCP列。
 * Windows先`netstat -ano`，查無或失敗時再以`Get-NetTCPConnection -LocalPort`確認(部分系統之netstat會漏列新起之監聽、並把對外連線之狀態錯置為LISTENING，故不單靠netstat判無人)，
 * 其查無才判無人；其他平台以`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`。無人監聽回傳[]，查詢失敗回傳null(呼叫端不得把null當成無人)。
 *
 * 耗時：在netstat漏列之系統上，新起之監聽與無人之port一律走PowerShell，每次約1秒；子指令阻塞事件迴圈，最久約2倍timeout(Windows)。
 * 於exit/signal處理器內呼叫時宜傳較短之timeout(例如5000)，免行程遲遲無法結束。
 *
 * 要確認「監聽者恰為某行程」(身分確認)或依監聽者殺行程時請傳useBoth:true：netstat有列出時預設不再查PowerShell，可能只得部分監聽者。
 *
 * 依賴可注入，供單元測試。移植自w-web-task test/tools/harnessProc.mjs
 *
 * @param {Number} port 輸入port，須為1~65535之整數
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.exec=null] 輸入同步執行子指令函數，格式為(prog, args, { src, timeout, maxBuffer })=>{ status, stdout, error }(與child_process.spawnSync同形)，src為'netstat'、'powershell'、'lsof'，預設null為wsemi內建之spawnSync執行函數(隱藏視窗、不經shell)
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，'win32'走netstat與Get-NetTCPConnection，其餘走lsof，預設process.platform
 * @param {Number} [opt.timeout=10000] 輸入每個子指令之逾時毫秒數，預設10000
 * @param {Boolean} [opt.useBoth=false] 輸入Windows下netstat有查到時是否仍以Get-NetTCPConnection再查並取聯集，為true時Get-NetTCPConnection失敗即回傳null，預設false
 * @param {Function} [opt.onTrace=null] 輸入觀察回調函數，傳入凍結之事件物件{ type, ... }，type為'run'、'result'、'settle'，失敗之訊息為settle事件之msg，預設null
 * @returns {Array|null} 回傳PID字串陣列(去重、由小到大)，無人回傳[]，查詢失敗回傳null
 * @example
 *
 * import listenerPids from 'w-package-tools-e2e/src/listenerPids.mjs'
 *
 * console.log(listenerPids(11007))
 * // => ['18168']
 *
 * console.log(listenerPids(11007, { useBoth: true, timeout: 5000 }))
 * // => ['18168']
 *
 */
function listenerPids(port, opt = {}) {
    let { exec, platform, timeout, useBoth, onTrace } = opt
    let pids = execProcessPortPidsSync(port, { exec, platform, timeout, useBoth, onTrace })
    return pids === null ? null : pids.map(String)
}


export default listenerPids
