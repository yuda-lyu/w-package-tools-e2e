/**
 * 確定性渲染之Chromium啟動旗標(六旗標)，供像素比對之截圖使用
 *
 * headless Chromium預設GPU光柵化與次像素字形反鋸齒，於像素比對下非決定性(拉丁字偶發散落差異，CJK灰階反鋸齒較穩故常只英文語系出錯)。
 * 本組關閉GPU(改走CPU Skia)、固定sRGB色彩、關閉LCD與次像素字形定位、關閉Skia執行期最佳化與部分光柵化，
 * 四個web專案實測截圖自我一致(同態連拍)由裸啟動之2/4提升為5/5。旗標組改動即全部標準圖須重產
 *
 * 陣列已凍結，需增加旗標時由launchBrowser之opt.args附加
 *
 * @returns {Array} 回傳旗標字串陣列
 * @example
 *
 * import chromiumLaunchArgs from 'w-package-tools-e2e/src/chromiumLaunchArgs.mjs'
 *
 * console.log(chromiumLaunchArgs)
 * // => ['--disable-gpu', '--force-color-profile=srgb', '--disable-lcd-text', '--disable-font-subpixel-positioning', '--disable-skia-runtime-opts', '--disable-partial-raster']
 *
 */
let chromiumLaunchArgs = Object.freeze([
    '--disable-gpu', //改走CPU Skia(本已軟體合成之機器為no-op, 仍保留防環境變動)
    '--force-color-profile=srgb', //固定色彩管理, 不吃主機ICC/HDR
    '--disable-lcd-text', //關LCD次像素文字反鋸齒, 改灰階反鋸齒
    '--disable-font-subpixel-positioning', //關字形次像素定位
    '--disable-skia-runtime-opts', //關Skia執行期最佳化分支
    '--disable-partial-raster', //關部分光柵化, 消tile重用殘影與位移
])


export default chromiumLaunchArgs
