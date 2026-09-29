/**
 * 「每步兩張」之單步：操作前框住將被操作之元素整顆 → 執行操作 → 等反應就緒 → 框住有反應之內容
 *
 * 依全域技能 role-coder-for-test-e2e §7.1(每個操作步驟兩張、兩張皆須有框)與 §7.2(先決定反應是什麼再決定框什麼)。
 * 相鄰兼任(§7.3-1 相鄰兩物取聯集為一框)：前一步之反應與本步之目標相鄰時，前一步之後圖即本步之前圖——
 * 此時呼叫端傳 before:null 表示不另拍；before 不可省略(undefined 即拋錯)，強制每一步明確決定是否兼任。
 * 泛化自 w-web-perm 之 setDialogModeWithShots／openChipsAllWithShots／setChipsAllModeWithShots 與 w-web-sso tokens 之 capturePermsChangeSave。
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} opt 輸入設定物件
 * @param {Function} opt.capture 輸入框圖截圖函數(page,target,opt)=>Promise<Buffer>，通常為專案之captureStableWithBox(已帶settle與strict組態)
 * @param {*} opt.before 輸入操作前之框選目標(選擇器、Locator、矩形或其陣列)；null代表由前一步之後圖兼任、不另拍
 * @param {Function} opt.act 輸入執行操作之函數async()=>{}(真滑鼠／鍵盤，技能 §4)
 * @param {Function} [opt.ready=null] 輸入等待反應就緒之函數async()=>{}(偵測driven，技能 §4.4)，預設null
 * @param {*} opt.after 輸入操作後之框選目標；為函數時於ready之後呼叫取得(目標於操作後才出現者)
 * @param {Object} [opt.beforeOpt={}] 輸入操作前截圖之設定物件(透傳capture)，預設{}
 * @param {Object} [opt.afterOpt={}] 輸入操作後截圖之設定物件(透傳capture)，預設{}
 * @returns {Promise} 回傳Promise，resolve回傳{before,after}，before為Buffer或null(兼任)，after為Buffer
 * @example
 *
 * import stepShots from 'w-package-tools-e2e/src/stepShots.mjs'
 *
 * let s = await stepShots(page, {
 *     capture: captureStableWithBox,
 *     before: saveBtnLoc(page),
 *     act: () => saveBtnLoc(page).click(),
 *     ready: () => waitCheckYes(page),
 *     after: '.w-checkyes-panel',
 * })
 * shots['E2E-003-5-click-save'] = s.before
 * shots['E2E-003-6-save-success-modal'] = s.after
 *
 */
async function stepShots(page, opt = {}) {
    let { capture, before, act, ready = null, after, beforeOpt = {}, afterOpt = {} } = opt
    if (typeof capture !== 'function') {
        throw new Error('stepShots: capture 須為函數(通常為專案之 captureStableWithBox)')
    }
    if (typeof act !== 'function') {
        throw new Error('stepShots: act 須為函數')
    }
    if (before === undefined) {
        throw new Error('stepShots: before 不可省略——給操作前之框選目標, 或傳 null 表示由前一步之後圖兼任(技能 §7.3-1)')
    }
    if (after === undefined || after === null) {
        throw new Error('stepShots: after 為必填(操作後有反應之內容, 技能 §7.2)')
    }
    let bufBefore = before === null ? null : await capture(page, before, beforeOpt)
    await act()
    if (ready) {
        await ready()
    }
    let target = typeof after === 'function' ? await after() : after
    let bufAfter = await capture(page, target, afterOpt)
    return { before: bufBefore, after: bufAfter }
}


export default stepShots
