import sharp from 'sharp'


/**
 * 以參考圖refBuf同座標之內容覆蓋截圖buffer之指定矩形(貼圖覆蓋，取代填黑)
 *
 * 用途：動態圖表(canvas)跨行程渲染無法像素穩定、又需保留真實畫面者；產製端與比對端貼同一張參考圖，該區永遠一致，其餘區域仍逐像素比對。
 * refBuf須與buf同版面同尺寸(同座標取用)，矩形夾在兩者邊界內
 *
 * @param {Buffer} buf 輸入PNG之Buffer
 * @param {Array} rects 輸入矩形陣列，每個元素為{x,y,w,h}(buffer座標)
 * @param {Buffer} refBuf 輸入參考圖PNG之Buffer
 * @returns {Promise} 回傳Promise，resolve回傳覆蓋後之PNG Buffer，無有效矩形時回傳原buffer
 * @example
 *
 * import overlayRegions from 'w-package-tools-e2e/src/overlayRegions.mjs'
 *
 * buf = await overlayRegions(buf, [{ x: 240, y: 330, w: 1000, h: 380 }], fs.readFileSync('./test/pics/stainfor/_staref-eng-chart.png'))
 *
 */
async function overlayRegions(buf, rects, refBuf) {
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let refMeta = await sharp(refBuf).metadata()
    let composite = []
    for (let r of (rects || []).filter((r) => r.w > 0 && r.h > 0)) {
        let left = Math.max(0, Math.round(r.x))
        let top = Math.max(0, Math.round(r.y))
        //夾在buf與ref兩者邊界內
        let width = Math.min(Math.round(r.w), imgW - left, refMeta.width - left)
        let height = Math.min(Math.round(r.h), imgH - top, refMeta.height - top)
        if (width <= 0 || height <= 0) {
            continue
        }
        let crop = await sharp(refBuf).extract({ left, top, width, height }).png().toBuffer()
        composite.push({ input: crop, left, top })
    }
    if (composite.length === 0) {
        return buf
    }
    return await sharp(buf).composite(composite).png().toBuffer()
}


export default overlayRegions
