/**
 * 判斷子行程是否仍存活('exit'事件尚未發生)
 *
 * @param {ChildProcess} child 輸入子行程
 * @returns {Boolean} 回傳是否存活
 * @example
 *
 * import isChildAlive from 'w-package-tools-e2e/src/isChildAlive.mjs'
 *
 * console.log(isChildAlive(child))
 * // => true
 *
 */
function isChildAlive(child) {
    return !!child && child.exitCode === null && child.signalCode === null
}


export default isChildAlive
