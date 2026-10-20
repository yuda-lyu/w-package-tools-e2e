/**
 * 建立「已知缺陷」錯誤：案例走到已登錄於spec〈已知落差〉之產品缺陷徵狀時拋出，
 * 產製端跳過缺陷畫面不寫圖(壞掉的畫面不得凍結為標準圖)，比對端交由測試框架標為pending
 *
 * 錯誤物件帶knownDefect:true與ref(〈已知落差〉之條目識別)；runBaselineCase據此分流。
 * 缺陷落在案例後段時(部分已知缺陷)，可帶shots(缺陷之前已取得、畫面正常之截圖，格式同run之回傳)，錯誤物件即帶shots(同一參考)；
 * runBaselineCase搭配stages與defectStages時，產製端照常寫出、比對端照常比對這些前段截圖，缺陷步之圖鍵不產不比。
 * 未帶shots者為整案已知缺陷(行為不變：產製端整案不寫、比對端不比任何一張)。
 * 帶shots之已知缺陷僅能由run拋出；1.0.8及之前shots被靜默忽略，此後生效
 *
 * @param {String} message 輸入徵狀描述字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.ref=''] 輸入已知落差條目識別字串(例如spec檔名與日期)，預設''
 * @param {Buffer|Object|Array} [opt.shots] 輸入缺陷之前已取得之截圖，格式同run之回傳(Buffer、{圖鍵:Buffer}、[{name,buf}]、{shots,page})，預設不帶(整案已知缺陷)；給定時須為物件，否則拋錯
 * @returns {Error} 回傳帶knownDefect標記之錯誤物件，有給shots時另帶shots
 * @example
 *
 * import createKnownDefect from 'w-package-tools-e2e/src/createKnownDefect.mjs'
 *
 * //整案已知缺陷
 * if (await page.locator('.webpack-dev-server-client-overlay').count() > 0) {
 *     throw createKnownDefect('儲存後出現未捕捉例外覆蓋層', { ref: 'spec/流程_xxx.md 已知落差 2026-09-27' })
 * }
 *
 * //部分已知缺陷: 第4步才走到缺陷, 前3步之截圖(shots)照常產製與比對(runBaselineCase 須給 stages 與 defectStages)
 * throw createKnownDefect('第4步全不選後出現空白表格', { ref: 'spec/流程_xxx.md 已知落差 2026-10-20', shots })
 *
 */
function createKnownDefect(message, opt = {}) {
    let { ref = '', shots } = opt
    let err = new Error(`[已知缺陷] ${message}${ref ? ` (${ref})` : ''}`)
    err.knownDefect = true
    err.ref = ref
    if (shots !== undefined && shots !== null) {
        if (typeof shots !== 'object') {
            throw new Error(`createKnownDefect: shots 須為 Buffer、物件或陣列(格式同 run 之回傳)，實得 ${typeof shots}`)
        }
        err.shots = shots
    }
    return err
}


export default createKnownDefect
