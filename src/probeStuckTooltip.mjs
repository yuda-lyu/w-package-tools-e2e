/**
 * 【w-component-vue】截圖前偵測提示框殘留(captureStable之beforeShots掛鉤)：captureStable已將游標移至(0,0)並初始等待後，仍顯示之hover型提示框(w-component-vue WTooltip mode='tooltip')必為殘留，
 * 即mouseleave未送達其觸發區，拋錯使該案失敗(殘留畫面不得凍結為標準圖)。點開型浮層(mode='popup'：WPopup、下拉清單)為刻意開啟，不在此列；
 * display:none與visibility:hidden(popper之data-popper-reference-hidden)皆非畫面可見。
 *
 * 背景：w-component-vue ≤2.5.23之WButtonCircle於點擊時以v-if換掉游標下之圖示(promiseUnlock或loading之載入圖示、停用遮罩)，其後出現全頁遮罩或游標隨即移開時，
 * 未採「命中節點被移除後以最近仍在DOM之祖先為目標」之瀏覽器(Chrome 144以前；Playwright ≤1.62之預設啟動參數停用BoundaryEventDispatchTracksNodeRemoval)不派發mouseleave，
 * 提示框殘留；2.5.24起圖示層與停用遮罩pointer-events:none已修正。本函數為回歸守門，亦涵蓋他處同型成因(自寫元件之內層被移除替換)。
 * 以提示文字判斷殘留會漏(對話框標題列Save鈕等其他文字之提示框)，且.WPopperFix亦用於下拉浮層，故依元件設定(mode)辨識，文字不限。
 *
 * WTooltip未宣告name，以結構辨識：$refs含divTrigger與divContent、props.mode、data.valueTrans(w-component-vue 2.5.24之WTooltip.vue)。
 * 本函數依賴上述內部欄位：元件改名或改寫時會找不到任何提示框而一律通過(靜默失效)，升級w-component-vue時須以真元件頁複驗(hover中偵測得到、移開後為空、已開之WPopup不誤判)。
 * 根實例：opt.rootSel有給時取該元素之__vue__；否則取window.$vo(應用掛上者)，再否則取body直屬元素之__vue__；皆無則不檢查(非Vue頁面)。
 *
 * @param {Object} page 輸入Playwright頁面物件
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.rootSel=''] 輸入掛有Vue 2根實例(__vue__)之元素選擇器字串，預設''(用window.$vo或body直屬元素之__vue__)
 * @param {Function} [opt.createError] 輸入依殘留文字陣列產生錯誤物件之函數(texts)=>Error，預設產生一般Error(訊息列出各提示文字)
 * @returns {Promise} 回傳Promise，無殘留時resolve回傳空陣列；有殘留時reject回傳錯誤物件
 * @example
 *
 * import captureStable from 'w-package-tools-e2e/src/captureStable.mjs'
 * import probeStuckTooltip from 'w-package-tools-e2e/src/probeStuckTooltip.mjs'
 *
 * let buf = await captureStable(page, { beforeShots: [probeStuckTooltip] })
 *
 */
async function probeStuckTooltip(page, opt = {}) {
    let rootSel = opt.rootSel || ''
    let createError = typeof opt.createError === 'function' ? opt.createError : (texts) => new Error(`游標已移開，提示框「${texts.join('」「')}」仍顯示(提示框殘留：mouseleave未送達觸發區)`)
    let texts = await page.evaluate((rootSel) => {
        let out = []
        let walk = (vm) => {
            let refs = vm.$refs || {}
            if (refs.divTrigger && refs.divContent && vm.$props && vm.$props.mode === 'tooltip' && vm.valueTrans === true) {
                let el = refs.divContent
                let cs = window.getComputedStyle(el)
                let r = el.getBoundingClientRect()
                if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
                    out.push((el.innerText || '').trim())
                }
            }
            for (let c of vm.$children || []) {
                walk(c)
            }
        }
        let root = null
        if (rootSel) {
            let el = document.querySelector(rootSel)
            root = el && el.__vue__ ? el.__vue__.$root : null
        }
        else if (window.$vo) {
            root = window.$vo.$root
        }
        else {
            for (let el of document.querySelectorAll('body > *')) {
                if (el.__vue__) {
                    root = el.__vue__.$root
                    break
                }
            }
        }
        if (root) {
            walk(root)
        }
        return out
    }, rootSel)
    if (texts.length > 0) {
        throw createError(texts)
    }
    return texts
}


export default probeStuckTooltip
