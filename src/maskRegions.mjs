import sharp from 'sharp'


/**
 * 對截圖buffer之指定矩形填色(截圖後以sharp合成，不改動被測頁DOM)
 *
 * 用途限於DOM層凍不到之動態內容(例如img內SVG SMIL動畫、無法固定之即時數值)；絕不用來遮應被偵測之靜態UI。
 * 預設黑色，一眼可辨為刻意遮蔽。矩形座標為buffer座標(全頁截圖時為視窗座標加捲動量)，超出buffer之部分自動裁切，寬或高為0者略過
 *
 * @param {Buffer} buf 輸入PNG之Buffer
 * @param {Array} rects 輸入矩形陣列，每個元素為{x,y,w,h}
 * @param {Object} [color={r:0,g:0,b:0}] 輸入填色物件，預設黑色
 * @returns {Promise} 回傳Promise，resolve回傳填色後之PNG Buffer，無有效矩形時回傳原buffer
 * @example
 *
 * import maskRegions from 'w-package-tools-e2e/src/maskRegions.mjs'
 *
 * let buf = await page.screenshot({ fullPage: true })
 * buf = await maskRegions(buf, [{ x: 10, y: 20, w: 100, h: 30 }])
 *
 */
async function maskRegions(buf, rects, color = { r: 0, g: 0, b: 0 }) {
    //讀image邊界, 夾在buffer內, 避免sharp composite「Image to composite must have same dimensions or smaller」
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let composite = (rects || [])
        .filter((r) => r.w > 0 && r.h > 0)
        .map((r) => {
            let left = Math.max(0, Math.round(r.x))
            let top = Math.max(0, Math.round(r.y))
            let width = Math.min(Math.round(r.w), imgW - left)
            let height = Math.min(Math.round(r.h), imgH - top)
            return { left, top, width, height }
        })
        .filter((c) => c.width > 0 && c.height > 0 && c.left < imgW && c.top < imgH)
        .map((c) => ({
            input: {
                create: {
                    width: c.width,
                    height: c.height,
                    channels: 3,
                    background: color,
                },
            },
            left: c.left,
            top: c.top,
        }))
    if (composite.length === 0) {
        return buf
    }
    return await sharp(buf).composite(composite).png().toBuffer()
}


export default maskRegions
