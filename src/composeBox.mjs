import sharp from 'sharp'


/**
 * 把紅框以sharp疊到截圖buffer上(截圖後合成，不注入DOM)，標注本張標準圖之觀看或操作區
 *
 * 幾何：目標區外擴pad(預設6)，四邊夾在bounds內並留margin(預設3)；SVG之stroke置中於路徑，
 * 故外緣落在夾邊後之矩形上，等效DOM版border-box之5px內縮框線。框過小(寬或高不足stroke)時預設不畫、回傳原buffer(guardSmall=false則照畫，重現無此守門之專案)。
 * why不注入DOM：插入後又移除之暫時DOM偶發使整頁光柵化偏1px，量測工具不得改動被測頁
 *
 * @param {Buffer} buf 輸入PNG之Buffer
 * @param {Object} box 輸入目標區物件{left,top,right,bottom}(buffer座標，已含捲動量)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} [opt.bounds] 輸入夾邊範圍物件{left,top,right,bottom}(buffer座標)，預設為整張buffer；只框視窗內者給視窗矩形加捲動量
 * @param {Number} [opt.pad=6] 輸入外擴像素，預設6
 * @param {Number} [opt.margin=3] 輸入夾邊時與邊界之距離像素，預設3
 * @param {Number} [opt.strokeWidth=5] 輸入框線寬度像素，預設5
 * @param {String} [opt.color='#f26'] 輸入框線顏色字串，預設'#f26'
 * @param {Number} [opt.radius=4] 輸入圓角像素，預設4
 * @param {Boolean} [opt.guardSmall=true] 輸入框過小時是否不畫布林值，預設true
 * @param {Function} [opt.onSkip] 輸入框過小而未畫時之回呼函數(reason)=>void，預設無；呼叫端可據以拋錯(captureStableWithBox 以此偵測「靜默無框」)
 * @returns {Promise} 回傳Promise，resolve回傳畫上紅框之PNG Buffer
 * @example
 *
 * import composeBox from 'w-package-tools-e2e/src/composeBox.mjs'
 *
 * buf = await composeBox(buf, { left: 100, top: 50, right: 300, bottom: 120 })
 *
 */
//框幾何預設值(外擴與框線寬)；itemsUnionBox 據以把框線置於相鄰項目之間隙正中，故集中於此一處
export const BOX_PAD = 6
export const BOX_STROKE = 5


async function composeBox(buf, box, opt = {}) {
    let { pad = BOX_PAD, margin = 3, strokeWidth = BOX_STROKE, color = '#f26', radius = 4, guardSmall = true } = opt
    let meta = await sharp(buf).metadata()
    let bounds = opt.bounds || { left: 0, top: 0, right: meta.width, bottom: meta.height }
    let bl = Math.max(bounds.left + margin, box.left - pad)
    let bt = Math.max(bounds.top + margin, box.top - pad)
    let br = Math.min(bounds.right - margin, box.right + pad)
    let bb = Math.min(bounds.bottom - margin, box.bottom + pad)
    if (guardSmall && (br - bl <= strokeWidth || bb - bt <= strokeWidth)) {
        if (typeof opt.onSkip === 'function') {
            opt.onSkip(`框過小(夾邊後 ${Math.round(br - bl)}x${Math.round(bb - bt)}px, 不足 stroke ${strokeWidth}px; 目標可能在畫面外或尺寸為 0)`)
        }
        return buf
    }
    let half = strokeWidth / 2
    let svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${bl + half}" y="${bt + half}" width="${br - bl - strokeWidth}" height="${bb - bt - strokeWidth}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" rx="${radius}" ry="${radius}"/>` +
        `</svg>`
    return await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
}


export default composeBox
