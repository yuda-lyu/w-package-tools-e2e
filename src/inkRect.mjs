import { BOX_PAD, BOX_STROKE } from './composeBox.mjs'


/**
 * 文字墨跡之紅框留白：紅框幾何為目標 ±6 且 5px 描邊內縮，目標矩形緊貼文字墨跡時框內僅剩約 1px(紅框壓字)。
 * 墨跡外擴 INK_PAD(4px)後框內留白約 5px，與自帶內距之按鈕相當(2026-09-28)。
 * itemsUnionBox 之 fit 以同一常數外擴 DOM 文字墨跡；本函數供「無 DOM 之緊貼墨跡矩形」(canvas 圖例列、翻頁箭頭、圖例項等，
 * 由圖表程式庫回報之視窗座標矩形)使用，交給 captureStableWithBox 作為矩形目標。
 * neighbors(2026-09-28)：同一列之其他項目矩形(例：其他圖例項)；外擴後框線不越過與鄰項間隙之正中，不壓到鄰項(業主：亂框亂壓遮蔽有效資訊即缺陷)。
 * 矩形須為「實際墨跡」：圖表程式庫回報之文字／項目矩形常比畫出之字形寬數 px，以之取中點框線會偏向鄰項——先經 canvasInkRects 收斂；
 * 鄰項須含畫面上有墨跡之全部項目(被捲動窗裁掉一部分者亦算，canvasInkRects 只回其可見部分)，不可只取完整顯示者
 * (w-web-perm 統計圖例項殷鑑：兩者皆未做時，框線距自身文字 7px、貼下一項圖示 0px)。
 *
 * @param {Object} rect 輸入視窗座標矩形物件{x,y,width,height}
 * @param {Number|Object} [opt=INK_PAD] 輸入外擴像素數字，或設定物件{pad,neighbors}
 * @param {Number} [opt.pad=INK_PAD] 輸入外擴像素，預設INK_PAD(4)
 * @param {Array} [opt.neighbors=[]] 輸入鄰項矩形陣列(同為{x,y,width,height})，預設[]
 * @returns {Object} 回傳外擴後之矩形物件{x,y,width,height}
 * @example
 *
 * import inkRect from 'w-package-tools-e2e/src/inkRect.mjs'
 *
 * let buf = await captureStableWithBox(page, inkRect(legend.rect))
 * let buf2 = await captureStableWithBox(page, inkRect(item.rect, { neighbors: others.map((o) => o.rect) }))
 *
 */
export const INK_PAD = 4


function inkRect(rect, opt = INK_PAD) {
    let isRect = (r) => !!r && ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number')
    if (!isRect(rect)) {
        throw new Error('inkRect: rect 須為 {x,y,width,height} 之數值矩形')
    }
    let { pad = INK_PAD, neighbors = [] } = (typeof opt === 'number') ? { pad: opt } : (opt || {})
    if (typeof pad !== 'number' || !(pad >= 0)) {
        throw new Error('inkRect: pad 須為非負數')
    }
    let left = rect.x - pad
    let top = rect.y - pad
    let right = rect.x + rect.width + pad
    let bottom = rect.y + rect.height + pad
    //框線中心在目標邊外 edge 處；與鄰項間隙之正中為界
    let edge = BOX_PAD - BOX_STROKE / 2
    let r0 = { l: rect.x, t: rect.y, r: rect.x + rect.width, b: rect.y + rect.height }
    for (let n of neighbors) {
        if (!isRect(n)) {
            continue
        }
        let nb = { l: n.x, t: n.y, r: n.x + n.width, b: n.y + n.height }
        let vOverlap = nb.b > r0.t && nb.t < r0.b
        let hOverlap = nb.r > r0.l && nb.l < r0.r
        if (vOverlap && nb.l >= r0.r - 1) {
            right = Math.min(right, (r0.r + nb.l) / 2 - edge)
        }
        else if (vOverlap && nb.r <= r0.l + 1) {
            left = Math.max(left, (nb.r + r0.l) / 2 + edge)
        }
        else if (hOverlap && nb.t >= r0.b - 1) {
            bottom = Math.min(bottom, (r0.b + nb.t) / 2 - edge)
        }
        else if (hOverlap && nb.b <= r0.t + 1) {
            top = Math.max(top, (nb.b + r0.t) / 2 + edge)
        }
    }
    if (right - left < 1 || bottom - top < 1) {
        return { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
}


export default inkRect
