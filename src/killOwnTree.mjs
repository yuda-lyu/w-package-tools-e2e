import { execSync } from 'child_process'
import isChildAlive from './isChildAlive.mjs'


/**
 * 同步殺自建子行程之整棵行程樹；已結束或無PID者不下殺(其PID可能已被系統回收給無關行程)
 *
 * Windows以同步`taskkill /F /T /PID <pid>`；其他平台先殺行程群組，失敗再退回child.kill('SIGKILL')。
 * 同步：exit/SIGINT/SIGTERM處理器內非同步spawn不會被等待。是否真的結束由呼叫端回驗(waitChildExit或pidExists)。
 * 移植自w-web-task test/tools/harnessProc.mjs
 *
 * @param {ChildProcess} child 輸入自建子行程
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.exec=execSync] 輸入同步執行指令函數，預設execSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，預設process.platform
 * @param {Function} [opt.killGroup] 輸入殺行程群組函數，預設process.kill(-pid,'SIGKILL')
 * @returns {Boolean} 回傳是否有下殺
 * @example
 *
 * import killOwnTree from 'w-package-tools-e2e/src/killOwnTree.mjs'
 *
 * killOwnTree(backendChild)
 *
 */
function killOwnTree(child, opt = {}) {
    let { exec = execSync, platform = process.platform, killGroup = (pid) => process.kill(-pid, 'SIGKILL') } = opt
    if (!child || !child.pid || !isChildAlive(child)) return false
    if (platform === 'win32') {
        try {
            exec(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore', timeout: 10000, windowsHide: true })
        }
        catch (e) {} //失敗與否一律由呼叫端回驗
        return true
    }
    try {
        killGroup(child.pid)
    }
    catch (e) {
        try {
            child.kill('SIGKILL')
        }
        catch (e2) {}
    }
    return true
}


export default killOwnTree
