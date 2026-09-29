import { execSync } from 'child_process'
import parseListenerPids from './parseListenerPids.mjs'


//同步指令一律帶逾時與隱藏視窗: 在exit/signal處理器內卡住會使行程無法結束
let EXEC_OPT = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true }


/**
 * 查詢監聽指定port之PID(同步)
 *
 * Windows以`netstat -ano`(不可加-p TCP，該參數只列IPv4，會漏掉以::雙堆疊監聽者)取得後以parseListenerPids解析；
 * 其他平台以`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`。無人監聽回傳[]，查詢工具不可用回傳null(呼叫端不得把null當成無人)。
 * 依賴可注入，供單元測試。移植自w-web-task test/tools/harnessProc.mjs
 *
 * @param {Number} port 輸入port
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.exec=execSync] 輸入同步執行指令函數，預設execSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，預設process.platform
 * @returns {Array|null} 回傳PID字串陣列，無人回傳[]，工具不可用回傳null
 * @example
 *
 * import listenerPids from 'w-package-tools-e2e/src/listenerPids.mjs'
 *
 * console.log(listenerPids(11007))
 * // => ['18168']
 *
 */
function listenerPids(port, opt = {}) {
    let { exec = execSync, platform = process.platform } = opt
    try {
        if (platform === 'win32') {
            return parseListenerPids(exec('netstat -ano', EXEC_OPT), port)
        }
        let out = exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, EXEC_OPT)
        return [...new Set(String(out).split(/\s+/).filter((s) => /^\d+$/.test(s)))]
    }
    catch (e) {
        //lsof查無監聽者時以exit 1結束=無人; 其餘(工具不存在, 逾時等)=不可用
        if (platform !== 'win32' && e && e.status === 1) return []
        return null
    }
}


export default listenerPids
