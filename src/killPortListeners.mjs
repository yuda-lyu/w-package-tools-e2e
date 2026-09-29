import { execSync } from 'child_process'
import listenerPids from './listenerPids.mjs'


/**
 * 殺監聽指定port之全部行程(含其行程樹；同步)
 *
 * 【政策】本函數會殺非本行程所建立之行程，只可用於「該port專屬本專案」且已於專案映射表明文登錄之情形
 * (例如重啟本專案後端而port被手動啟動之同專案後端佔用、逐檔隔離runner每檔前換新後端)；絕不可用於他專案或共用port。
 * Windows以`taskkill /F /T /PID`，其他平台以`kill -9`；exclude內之PID(預設本行程)不殺
 *
 * @param {Number} port 輸入port
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.exec=execSync] 輸入同步執行指令函數，預設execSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，預設process.platform
 * @param {Array} [opt.exclude=[process.pid]] 輸入不殺之PID陣列，預設[process.pid]
 * @returns {Object} 回傳物件{pids,killed}，pids為查得之監聽PID陣列(查詢工具不可用時為null)，killed為已下殺之PID陣列
 * @example
 *
 * import killPortListeners from 'w-package-tools-e2e/src/killPortListeners.mjs'
 *
 * let r = killPortListeners(11007)
 * console.log(r)
 * // => { pids: ['18168'], killed: ['18168'] }
 *
 */
function killPortListeners(port, opt = {}) {
    let { exec = execSync, platform = process.platform, exclude = [process.pid] } = opt
    let pids = listenerPids(port, { exec, platform })
    if (pids === null) {
        return { pids: null, killed: [] }
    }
    let ex = exclude.map(String)
    let killed = []
    for (let pid of pids) {
        if (ex.includes(String(pid))) continue
        try {
            if (platform === 'win32') {
                exec(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 10000, windowsHide: true })
            }
            else {
                exec(`kill -9 ${pid}`, { stdio: 'ignore', timeout: 10000 })
            }
            killed.push(String(pid))
        }
        catch (e) {} //已結束或無權限; 是否釋放由呼叫端回驗
    }
    return { pids, killed }
}


export default killPortListeners
