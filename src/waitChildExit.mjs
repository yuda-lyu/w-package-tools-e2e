import isChildAlive from './isChildAlive.mjs'


/**
 * 等子行程真正結束('exit'事件)，逾時回傳false；以事件判定，不受PID回收影響，逾時亦不留監聽器
 *
 * @param {ChildProcess} child 輸入子行程
 * @param {Number} timeoutMs 輸入逾時毫秒數
 * @returns {Promise} 回傳Promise，resolve回傳是否已結束
 * @example
 *
 * import waitChildExit from 'w-package-tools-e2e/src/waitChildExit.mjs'
 *
 * let ok = await waitChildExit(child, 5000)
 *
 */
function waitChildExit(child, timeoutMs) {
    return new Promise((resolve) => {
        if (!isChildAlive(child)) {
            resolve(true)
            return
        }
        let onExit = () => {
            clearTimeout(timer)
            resolve(true)
        }
        let timer = setTimeout(() => {
            child.removeListener('exit', onExit)
            resolve(false)
        }, timeoutMs)
        child.once('exit', onExit)
    })
}


export default waitChildExit
