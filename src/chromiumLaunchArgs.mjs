/**
 * 確定性渲染之Chromium啟動旗標(六旗標＋語系旗標，共七項)，供像素比對之截圖使用
 *
 * headless Chromium預設GPU光柵化與次像素字形反鋸齒，於像素比對下非決定性(拉丁字偶發散落差異，CJK灰階反鋸齒較穩故常只英文語系出錯)。
 * 本組關閉GPU(改走CPU Skia)、固定sRGB色彩、關閉LCD與次像素字形定位、關閉Skia執行期最佳化與部分光柵化(以上六旗標)，
 * 四個web專案實測截圖自我一致(同態連拍)由裸啟動之2/4提升為5/5。
 * 另固定應用程式語系為zh-TW(--lang=zh-TW)：Chromium 159(headless shell revision 1255)起不再繼承主機系統語系(預設en-US)，
 * generic字族(sans-serif與未指定字族)之字型隨語系改變(拉丁字由微軟正黑體變Arial、中文字由微軟正黑體變Microsoft YaHei簡體字形)，使截圖隨主機與Chromium版本而變；
 * 固定後字型不隨執行機器之系統語系而變，且與156(繼承zh-TW主機)之截圖逐位元相同(6種樣本頁實測，159加本旗標對156)。
 * 旗標組改動即全部標準圖須重產(對156時代之標準圖，159加本旗標於上述樣本頁逐位元相同，預期多數不必重產，仍以全量比對為準)
 *
 * 陣列已凍結，需增加旗標時由launchBrowser之opt.args附加；呼叫端經launchBrowser自給語系(opt.args含--lang、opt.lang為語系字串或false)時，
 * launchBrowser不帶本陣列之--lang，最終命令列之語系以呼叫端者為準
 *
 * @returns {Array} 回傳旗標字串陣列
 * @example
 *
 * import chromiumLaunchArgs from 'w-package-tools-e2e/src/chromiumLaunchArgs.mjs'
 *
 * console.log(chromiumLaunchArgs)
 * // => ['--disable-gpu', '--force-color-profile=srgb', '--disable-lcd-text', '--disable-font-subpixel-positioning', '--disable-skia-runtime-opts', '--disable-partial-raster', '--lang=zh-TW']
 *
 */
let chromiumLaunchArgs = Object.freeze([
    '--disable-gpu', //改走CPU Skia(本已軟體合成之機器為no-op, 仍保留防環境變動)
    '--force-color-profile=srgb', //固定色彩管理, 不吃主機ICC/HDR
    '--disable-lcd-text', //關LCD次像素文字反鋸齒, 改灰階反鋸齒
    '--disable-font-subpixel-positioning', //關字形次像素定位
    '--disable-skia-runtime-opts', //關Skia執行期最佳化分支
    '--disable-partial-raster', //關部分光柵化, 消tile重用殘影與位移
    '--lang=zh-TW', //固定應用程式語系: Chromium 159起不再繼承主機語系(預設en-US), generic字族與CJK後備字型隨語系而變; 與156繼承zh-TW主機之截圖逐位元相同, 不隨執行機器之系統語系而變
])


export default chromiumLaunchArgs
