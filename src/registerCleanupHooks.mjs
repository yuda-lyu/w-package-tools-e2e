/**
 * 註冊e2e收尾之兩條觸發來源與中斷備援：mocha root after(框架環境)、process之exit與中斷訊號
 *
 * 背景：spawn之子行程會拖住事件迴圈，process.on('exit')要等迴圈清空才觸發而形成互鎖，故框架環境須由root after主動收尾；
 * 直跑(非mocha，如--baseline產製)時globalThis.after不存在，由直跑主函式末尾顯式呼叫cleanup，exit與訊號處理器為備援。
 * 處理器內只能同步收尾(非同步spawn不會被等待)，故cleanup須為同步函數；teardown(可非同步，例如殺後回驗)只用於root after
 *
 * @param {Function} cleanup 輸入同步收尾函數
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.afterTimeoutMs=20000] 輸入root after之逾時毫秒數，預設20000
 * @param {Function} [opt.teardown=null] 輸入root after改呼叫之收尾函數(可回傳Promise)，預設null代表呼叫cleanup
 * @param {Object} [opt.signals={SIGINT:130,SIGTERM:143}] 輸入要處理之訊號與結束碼物件，預設{SIGINT:130,SIGTERM:143}
 * @param {Object} [opt.proc=process] 輸入process物件(供測試注入)，預設process
 * @param {Object} [opt.globals=globalThis] 輸入全域物件(供測試注入)，預設globalThis
 * @returns {Object} 回傳物件{mochaAfter}，mochaAfter代表是否已註冊root after
 * @example
 *
 * import registerCleanupHooks from 'w-package-tools-e2e/src/registerCleanupHooks.mjs'
 *
 * registerCleanupHooks(cleanup, { afterTimeoutMs: 20000 })
 *
 */
function registerCleanupHooks(cleanup, opt = {}) {
    let {
        afterTimeoutMs = 20000,
        teardown = null,
        signals = { SIGINT: 130, SIGTERM: 143 },
        proc = process,
        globals = globalThis,
    } = opt

    let mochaAfter = false
    if (typeof globals.after === 'function') {
        globals.after(async function() {
            this.timeout(afterTimeoutMs)
            if (typeof teardown === 'function') {
                await teardown()
            }
            else {
                cleanup()
            }
        })
        mochaAfter = true
    }

    proc.on('exit', cleanup)
    for (let [sig, code] of Object.entries(signals)) {
        proc.on(sig, () => {
            cleanup()
            proc.exit(code)
        })
    }

    return { mochaAfter }
}


export default registerCleanupHooks
