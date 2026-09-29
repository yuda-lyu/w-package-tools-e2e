/**
 * 判定e2e執行模式：是否為標準圖產製(regen)、是否處於診斷環境、截圖是否採strict
 *
 * regen：命令列含`--baseline`或環境變數E2E_REGEN為'1'；diag：環境變數E2E_BARE或E2E_DIAG有值；strictCapture：環境變數E2E_STRICT_CAPTURE為'1'。
 * 診斷閘門：regen且diag時拋錯(診斷環境下絕不可寫入正式標準圖，否則把診斷態凍結為真理)，可以opt.guard=false關閉(僅供測試)
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.argv=process.argv] 輸入命令列參數陣列，預設process.argv
 * @param {Object} [opt.env=process.env] 輸入環境變數物件，預設process.env
 * @param {Boolean} [opt.guard=true] 輸入是否啟用診斷閘門布林值，預設true
 * @returns {Object} 回傳模式物件{regen,diag,strictCapture}
 * @example
 *
 * import getE2eMode from 'w-package-tools-e2e/src/getE2eMode.mjs'
 *
 * let { regen } = getE2eMode()
 *
 */
function getE2eMode(opt = {}) {
    let { argv = process.argv, env = process.env, guard = true } = opt
    let regen = argv.includes('--baseline') || env.E2E_REGEN === '1'
    let diag = !!(env.E2E_BARE || env.E2E_DIAG)
    let strictCapture = env.E2E_STRICT_CAPTURE === '1'
    if (guard && regen && diag) {
        throw new Error('拒絕在診斷 env (E2E_BARE / E2E_DIAG) 下寫入正式 baseline')
    }
    return { regen, diag, strictCapture }
}


export default getE2eMode
