import fs from 'fs'
import path from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'


/**
 * 解析「有變更才改寫」之設定：keepSame未給時依環境變數E2E_BASELINE_KEEP_SAME==='1'；keepMaxDiff未給時依E2E_BASELINE_KEEP_MAXDIFF(非負整數字串)，皆未給為maxDiffPixels
 *
 * keepSame為false時不讀、不驗keepMaxDiff(未啟用即與未支援前一致)；E2E_BASELINE_KEEP_MAXDIFF格式錯誤即拋錯
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.keepSame] 輸入是否啟用布林值，預設依環境變數
 * @param {Number} [opt.keepMaxDiff] 輸入保留之差異上限(真不同像素數)，預設依環境變數，再預設為maxDiffPixels
 * @param {Number} [opt.maxDiffPixels=100] 輸入比對端容差，預設100
 * @param {Object} [opt.env=process.env] 輸入環境變數物件，預設process.env
 * @returns {Object} 回傳{keepSame,keepMaxDiff}
 */
export function resolveKeepSame(opt = {}) {
    let { keepSame, keepMaxDiff, maxDiffPixels = 100, env = process.env } = opt
    if (keepSame === undefined || keepSame === null) {
        keepSame = env.E2E_BASELINE_KEEP_SAME === '1'
    }
    keepSame = !!keepSame
    if (!keepSame) {
        return { keepSame, keepMaxDiff: null }
    }
    if (keepMaxDiff === undefined || keepMaxDiff === null) {
        let raw = env.E2E_BASELINE_KEEP_MAXDIFF
        if (raw === undefined || raw === null || String(raw).trim() === '') {
            keepMaxDiff = maxDiffPixels
        }
        else {
            let s = String(raw).trim()
            if (!/^\d+$/.test(s)) {
                throw new Error(`E2E_BASELINE_KEEP_MAXDIFF 須為非負整數，實得「${raw}」`)
            }
            keepMaxDiff = Number(s)
        }
    }
    if (!Number.isInteger(keepMaxDiff) || keepMaxDiff < 0) {
        throw new Error(`keepMaxDiff 須為非負整數，實得「${keepMaxDiff}」`)
    }
    return { keepSame, keepMaxDiff }
}


/**
 * 標準圖寫檔入口：「有變更才改寫」啟用時，與現行標準圖相同者保留原檔(不寫、mtime不變)，有變更才寫出當次截圖
 *
 * 未啟用(預設；E2E_BASELINE_KEEP_SAME未設)：直接寫出，不讀標準圖(與未支援前一致)。
 * 啟用時之判定(依序)：標準圖不存在 → 寫(missing)；transient為true(暫時狀態圖) → 不改寫(transient)；
 * 以toCompare(當次截圖,標準圖路徑)取得比對端覆蓋後之影像(未給即當次截圖；須與比對端用同一覆蓋)，尺寸不同 → 寫(sizeChanged)；
 * RGBA逐像素相同 → 保留(same)；keepMaxDiff為0 → 寫(只保留完全相同者；不以pixelmatch計數0為相同)；
 * 否則以pixelmatch(includeAA:false、threshold同比對端)計真不同像素數，≤keepMaxDiff → 保留，> → 寫。
 * 寫出者一律為當次截圖本身(不是覆蓋後之影像)；判定一律對正式標準圖路徑，寫出落點為outPath(E2E_BASELINE_OUT_DIR等)
 *
 * @param {Buffer} buf 輸入當次截圖PNG之Buffer
 * @param {String} baselinePath 輸入正式標準圖路徑字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.outPath=baselinePath] 輸入寫出路徑字串，預設baselinePath
 * @param {Boolean} [opt.keepSame] 輸入是否啟用有變更才改寫布林值，預設依環境變數E2E_BASELINE_KEEP_SAME==='1'
 * @param {Number} [opt.keepMaxDiff] 輸入保留之差異上限，預設依環境變數E2E_BASELINE_KEEP_MAXDIFF，再預設為maxDiffPixels；0代表只保留RGBA完全相同者
 * @param {Boolean} [opt.transient=false] 輸入是否為暫時狀態圖布林值(啟用時既有者不改寫)，預設false
 * @param {Function} [opt.toCompare=null] 輸入比對端覆蓋函數async(buf,baselinePath)=>Buffer，預設null代表不覆蓋
 * @param {Number} [opt.maxDiffPixels=100] 輸入比對端容差(keepMaxDiff之預設)，預設100
 * @param {Number} [opt.threshold=0.1] 輸入pixelmatch之色差門檻(須同比對端)，預設0.1
 * @param {Object} [opt.env=process.env] 輸入環境變數物件，預設process.env
 * @param {Function} [opt.writeFile] 輸入寫檔函數(path,buf)，預設建立上層目錄後fs.writeFileSync
 * @returns {Promise} 回傳Promise，resolve回傳{written,reason,numDiff}，reason於未啟用時為''，啟用時為'missing'、'transient'、'sizeChanged'、'same'、'same(diff=Npx≤M)'、'rgbaDiff(diff=0px)'或'diff=Npx'
 * @example
 *
 * import writeBaselineIfChanged from 'w-package-tools-e2e/src/writeBaselineIfChanged.mjs'
 *
 * //E2E_BASELINE_KEEP_SAME=1 E2E_BASELINE_KEEP_MAXDIFF=0 時: 與現行標準圖RGBA相同者不改寫
 * let r = await writeBaselineIfChanged(buf, './test/pics/x/x-eng-E2E-001-a.png', { toCompare: overlayLikeCompare })
 * console.log(r) //{ written: false, reason: 'same', numDiff: 0 }
 *
 */
async function writeBaselineIfChanged(buf, baselinePath, opt = {}) {
    let {
        outPath = baselinePath,
        transient = false,
        toCompare = null,
        maxDiffPixels = 100,
        threshold = 0.1,
        env = process.env,
        writeFile = (p, b) => {
            fs.mkdirSync(path.dirname(p), { recursive: true })
            fs.writeFileSync(p, b)
        },
    } = opt
    let { keepSame, keepMaxDiff } = resolveKeepSame({ keepSame: opt.keepSame, keepMaxDiff: opt.keepMaxDiff, maxDiffPixels, env })
    let write = (reason, numDiff = null) => {
        writeFile(outPath, buf)
        return { written: true, reason, numDiff }
    }
    if (!keepSame) {
        return write('')
    }
    if (!fs.existsSync(baselinePath)) {
        return write('missing')
    }
    if (transient) {
        return { written: false, reason: 'transient', numDiff: null }
    }
    let baseBuf = fs.readFileSync(baselinePath)
    let cmpBuf = typeof toCompare === 'function' ? await toCompare(buf, baselinePath) : buf
    if (!Buffer.isBuffer(cmpBuf)) {
        throw new Error('writeBaselineIfChanged: toCompare 須回傳 PNG 之 Buffer')
    }
    let a = PNG.sync.read(cmpBuf)
    let b = PNG.sync.read(baseBuf)
    if (a.width !== b.width || a.height !== b.height) {
        return write('sizeChanged')
    }
    if (a.data.equals(b.data)) {
        return { written: false, reason: 'same', numDiff: 0 }
    }
    let n = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold, includeAA: false })
    if (keepMaxDiff > 0 && n <= keepMaxDiff) {
        return { written: false, reason: `same(diff=${n}px≤${keepMaxDiff})`, numDiff: n }
    }
    //keepMaxDiff 為 0 時 RGBA 不同即寫, 計數 0 者另標(threshold 下之均勻小差不計入 pixelmatch)
    return write(n === 0 ? 'rgbaDiff(diff=0px)' : `diff=${n}px`, n)
}


export default writeBaselineIfChanged
