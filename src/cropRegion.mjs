import sharp from 'sharp'


/**
 * 自截圖buffer裁切指定矩形(夾在buffer內)，供把動態區域存成參考小圖
 *
 * @param {Buffer} buf 輸入PNG之Buffer
 * @param {Object} rect 輸入矩形物件{x,y,w,h}(buffer座標)
 * @returns {Promise} 回傳Promise，resolve回傳裁切後之PNG Buffer，矩形完全在圖外時reject
 * @example
 *
 * import cropRegion from 'w-package-tools-e2e/src/cropRegion.mjs'
 *
 * let ref = await cropRegion(buf, { x: 240, y: 330, w: 1000, h: 380 })
 *
 */
async function cropRegion(buf, rect) {
    let meta = await sharp(buf).metadata()
    let left = Math.max(0, Math.round(rect.x))
    let top = Math.max(0, Math.round(rect.y))
    let width = Math.min(Math.round(rect.w), meta.width - left)
    let height = Math.min(Math.round(rect.h), meta.height - top)
    return await sharp(buf).extract({ left, top, width, height }).png().toBuffer()
}


export default cropRegion
