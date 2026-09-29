import fs from 'fs'
import path from 'path'
import crypto from 'crypto'


/**
 * 盤點標準圖目錄之快照：每個圖檔之相對路徑、sha256、位元組數與mtime
 *
 * 用途：重產或改動共用設施之前後各取一次，交diffBaselineSnapshots比對，機械化「產前記下既有圖mtime，產後回驗未變」
 * (已審過之圖被重產等於換掉真理，即使內容看起來一樣)。只讀檔，不改動任何檔案。
 * 相對路徑一律以/分隔(跨平台可比)；目錄不存在時回傳空物件
 *
 * @param {String} dir 輸入標準圖根目錄字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {RegExp} [opt.pattern=/\.png$/i] 輸入納入之檔名樣式，預設/\.png$/i
 * @param {Boolean} [opt.recursive=true] 輸入是否遞迴子目錄布林值，預設true
 * @returns {Object} 回傳物件，鍵為相對路徑，值為{sha256,size,mtimeMs}
 * @example
 *
 * import snapshotBaselines from 'w-package-tools-e2e/src/snapshotBaselines.mjs'
 *
 * let before = snapshotBaselines('./test/pics')
 * //...重產或改動...
 * let after = snapshotBaselines('./test/pics')
 *
 */
function snapshotBaselines(dir, opt = {}) {
    let { pattern = /\.png$/i, recursive = true } = opt
    let out = {}
    if (!fs.existsSync(dir)) {
        return out
    }
    let walk = (d) => {
        let ents = fs.readdirSync(d, { withFileTypes: true })
        for (let e of ents) {
            let p = path.join(d, e.name)
            if (e.isDirectory()) {
                if (recursive) {
                    walk(p)
                }
                continue
            }
            if (!pattern.test(e.name)) {
                continue
            }
            let buf = fs.readFileSync(p)
            let st = fs.statSync(p)
            let rel = path.relative(dir, p).split(path.sep).join('/')
            out[rel] = {
                sha256: crypto.createHash('sha256').update(buf).digest('hex'),
                size: st.size,
                mtimeMs: st.mtimeMs,
            }
        }
    }
    walk(dir)
    return out
}


export default snapshotBaselines
