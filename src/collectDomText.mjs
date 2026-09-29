/**
 * 收集頁面DOM之文字節點內容(略過SCRIPT、STYLE、NOSCRIPT)，以分隔字串串接，供語意斷言失敗時印出頁面內容
 *
 * 注意：只走訪DOM文字節點，不判斷元素是否可見(隱藏元素之文字亦會收入)；每個文字節點先trim，空白者略過
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.sep=' | '] 輸入分隔字串，預設' | '
 * @param {Number} [opt.maxLen=2000] 輸入回傳字串最大長度，預設2000
 * @returns {Promise} 回傳Promise，resolve回傳串接後之字串
 * @example
 *
 * import collectDomText from 'w-package-tools-e2e/src/collectDomText.mjs'
 *
 * console.log(await collectDomText(page))
 * // => 'Tokens | 金鑰清單 | test-token-1 | ...'
 *
 */
async function collectDomText(page, opt = {}) {
    let { sep = ' | ', maxLen = 2000 } = opt
    return await page.evaluate(({ sep, maxLen }) => {
        let parts = []
        let walk = (el) => {
            if (!el) return
            if (el.nodeType === 3) {
                let t = (el.nodeValue || '').trim()
                if (t) parts.push(t)
                return
            }
            if (el.nodeType !== 1) return
            let tag = el.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return
            for (let c of el.childNodes) walk(c)
        }
        walk(document.body)
        return parts.join(sep).slice(0, maxLen)
    }, { sep, maxLen })
}


export default collectDomText
