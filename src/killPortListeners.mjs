import { spawnSync } from 'child_process'
import listenerPids from './listenerPids.mjs'


//預設執行函數(spawnSync形): 不經shell、隱藏視窗、帶逾時
function execDef(prog, args, { timeout, maxBuffer }) {
    return spawnSync(prog, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout, maxBuffer, windowsHide: true })
}


/**
 * 殺監聽指定port之全部行程(含其行程樹；同步)
 *
 * 【政策】本函數會殺非本行程所建立之行程，只可用於「該port專屬本專案」且已於專案映射表明文登錄之情形
 * (例如重啟本專案後端而port被手動啟動之同專案後端佔用、逐檔隔離runner每檔前換新後端)；絕不可用於他專案或共用port。
 * 以listenerPids(useBoth:true)查監聽者(殺行程須完整集合，不接受netstat漏列之部分結果)；
 * Windows以`taskkill /F /T /PID`，其他平台以`kill -9`(經sh之內建指令)；exclude內之PID(預設本行程)不殺
 *
 * @param {Number} port 輸入port
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.exec=spawnSync] 輸入同步執行子指令函數，查詢與下殺共用，格式為(prog, args, { src, timeout, maxBuffer })=>{ status, stdout, error }(與child_process.spawnSync同形)，查詢之src為'netstat'、'powershell'、'lsof'，下殺之src為'taskkill'、'kill'，預設為不經shell、隱藏視窗之spawnSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，預設process.platform
 * @param {Number} [opt.timeout=10000] 輸入每個子指令之逾時毫秒數，查詢與下殺皆用，於exit/signal處理器內呼叫時宜給較短值，預設10000
 * @param {Array} [opt.exclude=[process.pid]] 輸入不殺之PID陣列，預設[process.pid]
 * @returns {Object} 回傳物件{pids,killed}，pids為查得之監聽PID字串陣列(查詢失敗時為null)，killed為已下殺成功之PID字串陣列
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
    let { exec, platform = process.platform, timeout, exclude = [process.pid] } = opt
    let run = exec || execDef
    //逾時: 非正數、非數字或非有限值(Infinity)為預設; 小數進位為整數(spawnSync之timeout須為整數)
    let tn = Number(timeout)
    let to = Number.isFinite(tn) && tn > 0 ? Math.ceil(tn) : 10000
    let pids = listenerPids(port, { exec, platform, timeout: to, useBoth: true })
    if (pids === null) {
        return { pids: null, killed: [] }
    }
    let ex = exclude.map(String)
    let killed = []
    for (let pid of pids) {
        if (ex.includes(String(pid))) continue
        try {
            let win = platform === 'win32'
            let src = win ? 'taskkill' : 'kill'
            let prog = win ? 'taskkill' : 'sh'
            let args = win ? ['/F', '/T', '/PID', String(pid)] : ['-c', 'kill -9 "$1"', 'sh', String(pid)]
            let r = run(prog, args, { src, timeout: to, maxBuffer: 1024 * 1024 })
            if (r && !r.error && r.status === 0) {
                killed.push(String(pid))
            }
        }
        catch (e) {} //已結束或無權限; 是否釋放由呼叫端回驗
    }
    return { pids, killed }
}


export default killPortListeners
