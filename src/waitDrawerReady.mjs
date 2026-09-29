/**
 * 【w-component-vue】等WDrawer抽屜到達穩定態(opened或hidden)才放行
 *
 * 讀WDrawer根節點之[state]屬性(平移transitionend決定性標記hidden/opening/opened/hiding)，所有抽屜皆為opened或hidden即放行；
 * 事件驅動，不受主執行緒負載影響(取代易被減速尾段騙而截到半途之座標取樣)。頁面無WDrawer時立即放行；逾時(預設10000ms)不拋錯，交由呼叫端之連拍穩定兜底
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeout=10000] 輸入逾時毫秒數，預設10000
 * @returns {Promise} 回傳Promise，resolve代表已穩定或已逾時
 * @example
 *
 * import waitDrawerReady from 'w-package-tools-e2e/src/waitDrawerReady.mjs'
 *
 * await waitDrawerReady(page)
 *
 */
async function waitDrawerReady(page, opt = {}) {
    let { timeout = 10000 } = opt
    await page.waitForFunction(() => {
        let drawerStates = Array.from(document.querySelectorAll('[state]'))
            .map((e) => e.getAttribute('state'))
            .filter((s) => ['hidden', 'opening', 'opened', 'hiding'].includes(s))
        if (drawerStates.length === 0) {
            return true //無WDrawer, 放行
        }
        //所有抽屜須為穩定態, 不可停在opening/hiding過渡中
        return drawerStates.every((s) => s === 'opened' || s === 'hidden')
    }, null, { timeout, polling: 100 }).catch(() => {})
}


export default waitDrawerReady
