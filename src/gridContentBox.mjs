import { INK_PAD } from './inkRect.mjs'


/**
 * 【ag-grid】紅框「表格內容」之量測型目標：標頭(含浮動篩選列) ∪ 可見資料列，夾在表格框內；無資料列時改取標頭 ∪「無資料」訊息(外擴 INK_PAD)
 *
 * 交給captureStableWithBox作為target(或其陣列之一員)。技能 §7.2「表格出現/重算 → 標頭＋有資料的列，夾在表格框內」、
 * §7.3-2「不框整區空白」：直接框表格外框(.ag-root-wrapper)時，列數少的表格會把下方大片空白一起框進去(業主問「這到底是圈什麼」)。
 * 量測於捲入與等待之後、截圖之前進行；可見資料列＝與資料捲動區(.ag-body-viewport)有交集且高度大於0之.ag-row(含左側固定欄之列)。
 * 欄位未撐滿表格寬時(標頭容器撐滿、欄位只佔左側，例：兩欄之 IP 清單)，右側空白 ≥ 200px 且 ≥ 框寬 30% 即把右緣收在最後一欄(2026-09-28)。
 * 表格框找不到、或標頭與資料列、訊息皆量不到時回傳null(captureStableWithBox因此拋錯，不產出無框圖)。
 * 「無資料」訊息為無可見邊界之文字，其矩形即文字行框：直接取聯集時框之內緣只距行框 1px，字形墨跡至框內緣僅 3–4px
 * (2026-09-30 量測 w-web-sso／w-web-perm 之空表標準圖)，低於技能 §7.3-8 要求之約 5px；比照 itemsUnionBox 之 fit 與 inkRect
 * (無可見邊界之文字一律外擴 INK_PAD)，訊息矩形四周外擴 noRowsPad 後再取聯集。noRowsPad:0 可重現舊行為(供等價對照)。
 *
 * @param {String} gridSel 輸入表格外框之選擇器字串，例如'.ag-root-wrapper'或'.dlg .ag-root-wrapper'，取第一個命中者
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.noRowsSel='.ag-overlay-no-rows-center'] 輸入「無資料」訊息之選擇器字串(於表格框內查找)，預設'.ag-overlay-no-rows-center'
 * @param {Number} [opt.noRowsPad=INK_PAD] 輸入「無資料」訊息矩形之外擴像素，預設INK_PAD(4)
 * @returns {Object} 回傳量測型目標物件{label,scroll,measure}
 * @example
 *
 * import gridContentBox from 'w-package-tools-e2e/src/gridContentBox.mjs'
 *
 * let buf = await captureStableWithBox(page, gridContentBox('.ag-root-wrapper'))
 *
 */
function gridContentBox(gridSel, opt = {}) {
    let { noRowsSel = '.ag-overlay-no-rows-center', noRowsPad = INK_PAD } = opt
    return {
        label: `gridContentBox(${gridSel})`,
        scroll: gridSel,
        measure: async (page) => {
            return page.evaluate(({ gridSel, noRowsSel, noRowsPad }) => {
                let root = document.querySelector(gridSel)
                if (!root) {
                    return null
                }
                let rr = root.getBoundingClientRect()
                let body = root.querySelector('.ag-body-viewport') || root
                let br = body.getBoundingClientRect()
                let parts = []
                let push = (r) => {
                    if (r.width > 0 && r.height > 0) {
                        parts.push(r)
                    }
                }
                let hdr = root.querySelector('.ag-header')
                if (hdr) {
                    push(hdr.getBoundingClientRect())
                }
                let nRows = 0
                root.querySelectorAll('.ag-row').forEach((row) => {
                    let r = row.getBoundingClientRect()
                    if (r.height > 0 && r.width > 0 && r.bottom > br.top && r.top < br.bottom) {
                        push(r)
                        nRows++
                    }
                })
                if (nRows === 0) {
                    //訊息為無可見邊界之文字, 四周外擴 noRowsPad(同 fit 之文字外擴), 框內緣與文字留白; 聯集後仍夾在表格框內
                    root.querySelectorAll(noRowsSel).forEach((e) => {
                        let r = e.getBoundingClientRect()
                        if (r.width > 0 && r.height > 0) {
                            push({ left: r.left - noRowsPad, top: r.top - noRowsPad, right: r.right + noRowsPad, bottom: r.bottom + noRowsPad, width: r.width + 2 * noRowsPad, height: r.height + 2 * noRowsPad })
                        }
                    })
                }
                if (parts.length === 0) {
                    return null
                }
                let left = Math.max(Math.min(...parts.map((r) => r.left)), rr.left)
                let top = Math.max(Math.min(...parts.map((r) => r.top)), rr.top)
                let right = Math.min(Math.max(...parts.map((r) => r.right)), rr.right)
                let bottom = Math.min(Math.max(...parts.map((r) => r.bottom)), rr.bottom)
                //欄位未撐滿表格寬(標頭容器撐滿、欄位只佔左側)時，右側為整片空白：空白 ≥ 200px 且 ≥ 框寬 30%(K 類「大片空白」判準)
                //才把右緣收在最後一欄(標頭格 ∪ 資料列之右緣)；一般撐滿之表格右側僅捲軸槽，不收
                if (nRows > 0) {
                    let cols = []
                    root.querySelectorAll('.ag-header-cell').forEach((c) => {
                        let r = c.getBoundingClientRect()
                        if (r.width > 0 && r.height > 0) {
                            cols.push(r.right)
                        }
                    })
                    root.querySelectorAll('.ag-row').forEach((row) => {
                        let r = row.getBoundingClientRect()
                        if (r.height > 0 && r.width > 0 && r.bottom > br.top && r.top < br.bottom) {
                            cols.push(r.right)
                        }
                    })
                    let colsRight = cols.length > 0 ? Math.max(...cols) : right
                    let trail = right - colsRight
                    if (trail >= 200 && trail >= (right - left) * 0.3) {
                        right = colsRight
                    }
                }
                if (right <= left || bottom <= top) {
                    return null
                }
                return { x: left, y: top, width: right - left, height: bottom - top }
            }, { gridSel, noRowsSel, noRowsPad })
        },
    }
}


export default gridContentBox
