/**
 * 判斷頁面DOM是否有某個文字節點含指定字串(略過SCRIPT、STYLE、NOSCRIPT)
 *
 * 注意：逐一比對單一文字節點，跨多個節點(例如被<b>切開)之字串不會命中；不判斷元素是否可見
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {String} text 輸入要尋找之字串
 * @returns {Promise} 回傳Promise，resolve回傳是否找到之布林值
 * @example
 *
 * import pageHasText from 'w-package-tools-e2e/src/pageHasText.mjs'
 *
 * console.log(await pageHasText(page, '儲存金鑰數據成功'))
 * // => true
 *
 */
async function pageHasText(page, text) {
    return await page.evaluate((t) => {
        let walk = (el) => {
            if (!el) return false
            if (el.nodeType === 3) return (el.nodeValue || '').includes(t)
            if (el.nodeType !== 1) return false
            let tag = el.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false
            for (let c of el.childNodes) {
                if (walk(c)) return true
            }
            return false
        }
        return walk(document.body)
    }, text)
}


export default pageHasText
