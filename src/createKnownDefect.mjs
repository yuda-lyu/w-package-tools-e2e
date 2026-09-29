/**
 * 建立「已知缺陷」錯誤：案例走到已登錄於spec〈已知落差〉之產品缺陷徵狀時拋出，
 * 產製端跳過該案例不寫圖(壞掉的畫面不得凍結為標準圖)，比對端交由測試框架標為pending
 *
 * 錯誤物件帶knownDefect:true與ref(〈已知落差〉之條目識別)；runBaselineCase據此分流
 *
 * @param {String} message 輸入徵狀描述字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.ref=''] 輸入已知落差條目識別字串(例如spec檔名與日期)，預設''
 * @returns {Error} 回傳帶knownDefect標記之錯誤物件
 * @example
 *
 * import createKnownDefect from 'w-package-tools-e2e/src/createKnownDefect.mjs'
 *
 * if (await page.locator('.webpack-dev-server-client-overlay').count() > 0) {
 *     throw createKnownDefect('儲存後出現未捕捉例外覆蓋層', { ref: 'spec/流程_xxx.md 已知落差 2026-09-27' })
 * }
 *
 */
function createKnownDefect(message, opt = {}) {
    let { ref = '' } = opt
    let err = new Error(`[已知缺陷] ${message}${ref ? ` (${ref})` : ''}`)
    err.knownDefect = true
    err.ref = ref
    return err
}


export default createKnownDefect
