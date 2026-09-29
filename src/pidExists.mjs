/**
 * 同步判斷PID是否存在(exit/signal處理器內使用：事件迴圈不再推進，isChildAlive不會更新)
 *
 * 以kill(pid,0)探測：成功為存在、ESRCH為不存在、EPERM為存在(無權限)。PID回收只會造成誤報存在，不會誤殺
 *
 * @param {Number|String} pid 輸入PID
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.kill] 輸入kill函數，預設process.kill
 * @returns {Boolean} 回傳是否存在
 * @example
 *
 * import pidExists from 'w-package-tools-e2e/src/pidExists.mjs'
 *
 * console.log(pidExists(process.pid))
 * // => true
 *
 */
function pidExists(pid, opt = {}) {
    let { kill = (p, s) => process.kill(p, s) } = opt
    try {
        kill(Number(pid), 0)
        return true
    }
    catch (e) {
        return !!e && e.code === 'EPERM'
    }
}


export default pidExists
