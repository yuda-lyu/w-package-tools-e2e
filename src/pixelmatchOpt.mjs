/**
 * 比對端pixelmatch之判定選項(凍結物件)，為本套件所有以pixelmatch計差異像素之處之唯一預設來源
 *
 * 使用處：assertBaselineMatch、runBaselineCase(經assertBaselineMatch與writeBaselineIfChanged)、createBaselineGate(changed模式)、
 * writeBaselineIfChanged、compareImageDirs、reviewPendingShots，一律以`{ ...pixelmatchOpt, threshold }`呼叫(threshold為各函數之opt.threshold，預設即本物件之threshold)，不各自內嵌選項。
 *
 * 色差度量為pixelmatch 8(2026-11-09起)：像素以OKLab之toe校正明度Lr與色度a、b計HyAB距離(|ΔLr|+√(Δa²+Δb²))，距離大於threshold即判為差異；
 * 7.x為YIQ平方距離(> 35215·threshold²)，兩者對同一對顏色之判定不同、無選項可還原，故升版後下游既有標準圖之比對結果可能改變(處置見README〈pixelmatch 8 之比對度量〉)。
 *
 * 選項與理由(量測與證據見sgud/exp/experience.md「pixelmatch 8 之比對參數」)：
 * - threshold 0.1：灰階全表對7.2.0@0.1之判定一致率於0.1最高(98.96%；0.09為97.74%、0.11為98.54%、0.12為96.89%)，不透明灰階之臨界為23～29級(隨明度，近黑較敏感、近白較寬；7.x恆約27級)；
 *   雜訊類擾動(亮度±8、±16、單點±12、±20、模糊σ0.5)於330張真實標準圖之取樣110張皆通過(與7.x相同，0.08以下即開始誤報)；真實Chromium跨版本渲染差異對之計數與7.2.0相同或相近(比值0.77～1.18)；
 *   文字、色塊、邊框、陰影、1px平移、亮度±40之改變皆被抓到(與7.x相同；0.16以上開始漏掉亮度±40)。不放大以掩蓋真實改變
 * - includeAA false：反鋸齒邊緣像素不計(pixelmatch預設，明寫以免預設改變)
 * - checkerboard true：半透明像素以棋盤格背景混色後比對(pixelmatch 7.2.0與8之預設，明寫以免預設改變)；透明背景下半透明內容之真實改變(卡片opacity .8→1、半透明邊框alpha .3→.6)，7.2.0為0而8為9955、1821像素(偵測得到)；
 *   疊在有色塊上之遮罩alpha改變(.3→.45)則7.2.0與8皆為0，僅`checkerboard:false`(疊白底)為8400，為已知限制
 *
 * 動本物件之任一值即改變全部標準圖之比對結果，須依README〈pixelmatch 8 之比對度量〉處置，且unit-compareMetric會失敗
 *
 * @returns {Object} 回傳凍結之選項物件{threshold,includeAA,checkerboard}
 * @example
 *
 * import pixelmatch from 'pixelmatch'
 * import pixelmatchOpt from 'w-package-tools-e2e/src/pixelmatchOpt.mjs'
 *
 * let n = pixelmatch(imgA, imgB, null, width, height, { ...pixelmatchOpt })
 * console.log(pixelmatchOpt)
 * // => { threshold: 0.1, includeAA: false, checkerboard: true }
 *
 */
let pixelmatchOpt = Object.freeze({
    threshold: 0.1,
    includeAA: false,
    checkerboard: true,
})


export default pixelmatchOpt
