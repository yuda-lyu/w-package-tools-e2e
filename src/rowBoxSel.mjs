/**
 * 【ag-grid】框「整列」用之選擇器陣列：一列跨pinned-left與center兩容器(勾選框欄在pinned-left)，
 * 交給captureStableWithBox取聯集即框出涵蓋整列之紅框；單一.ag-row選擇器只會命中其中一個容器
 *
 * 順序不是中性的：captureStableWithBox只把「第一個」目標捲入視窗，故順序決定捲動對象，改順序可能改變截圖。
 * 預設['pinned-left','center'](w-web-sso各測試檔手寫之順序)；w-web-perm、w-web-task之現行實作為['center','pinned-left']，沿用時須以order指定
 *
 * @param {Number|String} rowIndex 輸入列之row-index
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.scope=''] 輸入限定範圍之選擇器前綴字串(例如對話框內之表格)，預設''
 * @param {Array} [opt.order=['pinned-left','center']] 輸入容器順序陣列，元素為'pinned-left'或'center'，預設['pinned-left','center']
 * @returns {Array} 回傳選擇器字串陣列
 * @example
 *
 * import rowBoxSel from 'w-package-tools-e2e/src/rowBoxSel.mjs'
 *
 * let buf = await captureStableWithBox(page, rowBoxSel(3))
 * let buf2 = await captureStableWithBox(page, rowBoxSel(3, { order: ['center', 'pinned-left'] }))
 *
 */
function rowBoxSel(rowIndex, opt = {}) {
    let { scope = '', order = ['pinned-left', 'center'] } = opt
    let p = scope ? `${scope} ` : ''
    let cont = {
        'pinned-left': '.ag-pinned-left-cols-container',
        'center': '.ag-center-cols-container',
    }
    return order.map((k) => {
        if (!cont[k]) {
            throw new Error(`rowBoxSel: order 元素須為 pinned-left 或 center，實得「${k}」`)
        }
        return `${p}${cont[k]} .ag-row[row-index="${rowIndex}"]`
    })
}


export default rowBoxSel
