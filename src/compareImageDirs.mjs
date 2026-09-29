import fs from 'fs'
import path from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'


/**
 * 逐檔比對兩個目錄內同名之PNG：位元組是否相同、解碼後RGBA是否相同、反鋸齒感知之像素差異數
 *
 * 用途：行為等價證明——把新管線之產製輸出導到暫存目錄(dirA)，與現行標準圖目錄(dirB)逐檔比對，不動標準圖本身。
 * 判準分層：bytesEqual(檔案位元組相同，受PNG編碼器與版本影響) ⊂ rgbaEqual(像素完全相同) ⊂ withinTolerance(pixelmatch差異數≤maxDiffPixels)。
 * 等價層(2026-09-28)：equivalent＝rgbaEqual，或RGBA相異之像素全數落在opt.drift登錄之漂移點(座標＋各通道差上限)內——
 * 不以「pixelmatch計數0」為等價：threshold 0.1時整片均勻亮度差在約26級以內之像素一律不計，會掩蓋肉眼可見之全域變化。
 * 各檔另報rgbaDiff(RGBA相異像素數)與rgbaDiffBox(其外接框)，供歸因。
 * 以dirA之檔案為準逐一比對；只存在於dirB者列於onlyInB(部分產製時屬正常，由呼叫端判斷)
 *
 * @param {String} dirA 輸入受檢目錄字串(例如產製輸出之暫存目錄)
 * @param {String} dirB 輸入對照目錄字串(例如現行標準圖目錄)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {RegExp} [opt.pattern=/\.png$/i] 輸入納入之檔名樣式，預設/\.png$/i
 * @param {Number} [opt.threshold=0.1] 輸入pixelmatch之色差門檻，預設0.1
 * @param {Number} [opt.maxDiffPixels=100] 輸入容許之真不同像素數，預設100
 * @param {Array} [opt.drift=[]] 輸入登錄漂移點陣列[{x,y,maxDelta,files}]，x,y為像素座標、maxDelta為各通道差上限、files為適用檔名之RegExp(省略則全部)，預設[]
 * @returns {Object} 回傳物件{files,onlyInB,summary}，files為各檔結果陣列[{file,status,bytesEqual,rgbaEqual,rgbaDiff,rgbaDiffBox,equivalent,numDiff,withinTolerance}]，status為'ok'、'missingInB'或'sizeMismatch'
 * @example
 *
 * import compareImageDirs from 'w-package-tools-e2e/src/compareImageDirs.mjs'
 *
 * let r = compareImageDirs('./test/_tmp/regen-out', './test/pics/tokens')
 * console.log(r.summary)
 * // => { total: 50, bytesEqual: 50, rgbaEqual: 50, equivalent: 50, withinTolerance: 50, exceeded: 0, missingInB: 0, sizeMismatch: 0, onlyInB: 0 }
 *
 */
function compareImageDirs(dirA, dirB, opt = {}) {
    let { pattern = /\.png$/i, threshold = 0.1, maxDiffPixels = 100, drift = [] } = opt
    let list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => pattern.test(f)).sort() : [])
    let listA = list(dirA)
    let setA = new Set(listA)
    let onlyInB = list(dirB).filter((f) => !setA.has(f))

    //RGBA 相異像素數、外接框, 以及是否全數落在登錄漂移點內
    let rgbaDiffOf = (file, a, b) => {
        let w = a.width
        let pts = drift.filter((p) => !p.files || p.files.test(file))
        let n = 0
        let unexplained = 0
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -1
        let y1 = -1
        for (let i = 0; i < a.data.length; i += 4) {
            if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) {
                continue
            }
            n++
            let px = (i / 4) % w
            let py = Math.floor(i / 4 / w)
            x0 = Math.min(x0, px)
            y0 = Math.min(y0, py)
            x1 = Math.max(x1, px)
            y1 = Math.max(y1, py)
            let d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]))
            if (!pts.some((p) => p.x === px && p.y === py && d <= p.maxDelta)) {
                unexplained++
            }
        }
        return { rgbaDiff: n, rgbaDiffBox: n > 0 ? { x0, y0, x1, y1 } : null, onlyDrift: n > 0 && unexplained === 0 }
    }

    let files = listA.map((file) => {
        let pb = path.join(dirB, file)
        if (!fs.existsSync(pb)) {
            return { file, status: 'missingInB', bytesEqual: false, rgbaEqual: false, rgbaDiff: null, rgbaDiffBox: null, equivalent: false, numDiff: null, withinTolerance: false }
        }
        let bufA = fs.readFileSync(path.join(dirA, file))
        let bufB = fs.readFileSync(pb)
        if (bufA.equals(bufB)) {
            return { file, status: 'ok', bytesEqual: true, rgbaEqual: true, rgbaDiff: 0, rgbaDiffBox: null, equivalent: true, numDiff: 0, withinTolerance: true }
        }
        let pngA = PNG.sync.read(bufA)
        let pngB = PNG.sync.read(bufB)
        if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
            return { file, status: 'sizeMismatch', bytesEqual: false, rgbaEqual: false, rgbaDiff: null, rgbaDiffBox: null, equivalent: false, numDiff: null, withinTolerance: false }
        }
        let rgbaEqual = pngA.data.equals(pngB.data)
        let rd = rgbaEqual ? { rgbaDiff: 0, rgbaDiffBox: null, onlyDrift: false } : rgbaDiffOf(file, pngA, pngB)
        let numDiff = rgbaEqual ? 0 : pixelmatch(pngA.data, pngB.data, null, pngA.width, pngA.height, { threshold, includeAA: false })
        return { file, status: 'ok', bytesEqual: false, rgbaEqual, rgbaDiff: rd.rgbaDiff, rgbaDiffBox: rd.rgbaDiffBox, equivalent: rgbaEqual || rd.onlyDrift, numDiff, withinTolerance: numDiff <= maxDiffPixels }
    })

    let count = (fn) => files.filter(fn).length
    let summary = {
        total: files.length,
        bytesEqual: count((r) => r.bytesEqual),
        rgbaEqual: count((r) => r.rgbaEqual),
        equivalent: count((r) => r.equivalent),
        withinTolerance: count((r) => r.withinTolerance),
        exceeded: count((r) => r.status === 'ok' && !r.withinTolerance),
        missingInB: count((r) => r.status === 'missingInB'),
        sizeMismatch: count((r) => r.status === 'sizeMismatch'),
        onlyInB: onlyInB.length,
    }
    return { files, onlyInB, summary }
}


export default compareImageDirs
