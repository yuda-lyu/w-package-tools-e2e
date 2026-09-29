/**
 * 等提示浮窗(wsemi domAlert，即 w-component-vue WAlert／vo.$alert；元素 id 以 alt- 開頭)全部消失
 *
 * 截圖之反應目標不是提示浮窗本身時(例：行內紅字)，浮窗在不在畫面上取決於時序(domAlert 預設數秒後自動移除)，截圖因而不確定。
 * 以偵測取代「固定等 N 秒」：先等反應目標就緒，再以本函數等浮窗消失後截圖
 * (w-web-sso login E2E-016 殷鑑：固定等待改偵測式後，文字一出現即截圖，截到尚未消失之錯誤浮窗而與標準圖不符)。
 * 反應目標即為提示浮窗者不可用本函數(應等其滑入定位後截圖，技能 §8.1)。
 *
 * @param {Object} page 輸入Playwright Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.sel='[id^="alt-"]'] 輸入提示浮窗之選擇器字串，預設'[id^="alt-"]'(wsemi domAlert)
 * @param {Number} [opt.timeout=30000] 輸入等待上限毫秒數，預設30000
 * @returns {Promise} 回傳Promise，浮窗全部消失時resolve；逾時reject(含仍在之浮窗數)
 * @example
 *
 * import waitAlertGone from 'w-package-tools-e2e/src/waitAlertGone.mjs'
 *
 * await waitUntilExist(page, '行內錯誤', (s) => document.body.innerText.includes(s), { arg: msg })
 * await waitAlertGone(page)
 * let buf = await captureStableWithBox(page, page.getByText(msg).last())
 *
 */
async function waitAlertGone(page, opt = {}) {
    let { sel = '[id^="alt-"]', timeout = 30000 } = opt
    if (typeof sel !== 'string' || sel.trim() === '') {
        throw new Error('waitAlertGone: sel 須為非空之選擇器字串')
    }
    try {
        await page.waitForFunction((s) => document.querySelectorAll(s).length === 0, sel, { timeout, polling: 100 })
    }
    catch (err) {
        let n = await page.evaluate((s) => document.querySelectorAll(s).length, sel).catch(() => '?')
        throw new Error(`waitAlertGone: ${timeout}ms 內提示浮窗未消失(仍有 ${n} 個 ${sel})`)
    }
}


export default waitAlertGone
