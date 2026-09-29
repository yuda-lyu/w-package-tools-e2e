/**
 * 同步睡眠(exit/signal處理器內回驗用；該處不能使用setTimeout)
 *
 * @param {Number} ms 輸入毫秒數
 * @returns {undefined} 無回傳
 * @example
 *
 * import sleepSync from 'w-package-tools-e2e/src/sleepSync.mjs'
 *
 * sleepSync(100)
 *
 */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}


export default sleepSync
