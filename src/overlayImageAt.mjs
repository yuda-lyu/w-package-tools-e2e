import sharp from 'sharp'


/**
 * 把一張已裁切成區域尺寸之小圖overlayBuf貼到截圖buffer之(left,top)，超出buffer邊界之部分自動裁切
 *
 * 用於貼圖覆蓋時只存「動態區域那一塊」之參考小圖(而非整頁)，一看即知只覆蓋該區，其餘區域仍逐像素比對
 *
 * @param {Buffer} buf 輸入PNG之Buffer
 * @param {Buffer} overlayBuf 輸入要貼上之小圖PNG Buffer
 * @param {Number} left 輸入貼上位置左緣像素
 * @param {Number} top 輸入貼上位置上緣像素
 * @returns {Promise} 回傳Promise，resolve回傳貼上後之PNG Buffer，貼上位置完全在圖外時回傳原buffer
 * @example
 *
 * import overlayImageAt from 'w-package-tools-e2e/src/overlayImageAt.mjs'
 *
 * buf = await overlayImageAt(buf, refChartBuf, 240, 330)
 *
 */
async function overlayImageAt(buf, overlayBuf, left, top) {
    let meta = await sharp(buf).metadata()
    let oMeta = await sharp(overlayBuf).metadata()
    left = Math.max(0, Math.round(left))
    top = Math.max(0, Math.round(top))
    let w = Math.min(oMeta.width, meta.width - left)
    let h = Math.min(oMeta.height, meta.height - top)
    if (w <= 0 || h <= 0) {
        return buf
    }
    let ov = overlayBuf
    if (w !== oMeta.width || h !== oMeta.height) {
        ov = await sharp(overlayBuf).extract({ left: 0, top: 0, width: w, height: h }).png().toBuffer()
    }
    return await sharp(buf).composite([{ input: ov, left, top }]).png().toBuffer()
}


export default overlayImageAt
