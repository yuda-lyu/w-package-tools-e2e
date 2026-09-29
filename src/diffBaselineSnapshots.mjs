/**
 * 比對兩次snapshotBaselines之結果，列出新增、刪除、內容改變、內容相同但被重寫(mtime改變)之檔案
 *
 * touched(內容相同但mtime改變)亦視為「被重寫」：已審過之圖被重產等於換掉真理，即使內容相同，
 * 故「零標準圖變動」須added、removed、changed、touched皆為空(unchanged為true)
 *
 * @param {Object} before 輸入先前之快照物件
 * @param {Object} after 輸入之後之快照物件
 * @returns {Object} 回傳物件{added,removed,changed,touched,unchanged}，前四者為相對路徑陣列(已排序)，unchanged為四者皆空之布林值
 * @example
 *
 * import snapshotBaselines from 'w-package-tools-e2e/src/snapshotBaselines.mjs'
 * import diffBaselineSnapshots from 'w-package-tools-e2e/src/diffBaselineSnapshots.mjs'
 *
 * let before = snapshotBaselines('./test/pics')
 * //...
 * let r = diffBaselineSnapshots(before, snapshotBaselines('./test/pics'))
 * if (!r.unchanged) throw new Error(`標準圖被改動: ${JSON.stringify(r)}`)
 *
 */
function diffBaselineSnapshots(before, after) {
    let b = before || {}
    let a = after || {}
    let added = []
    let removed = []
    let changed = []
    let touched = []
    for (let k of Object.keys(a)) {
        if (!(k in b)) {
            added.push(k)
            continue
        }
        if (a[k].sha256 !== b[k].sha256) {
            changed.push(k)
        }
        else if (a[k].mtimeMs !== b[k].mtimeMs) {
            touched.push(k)
        }
    }
    for (let k of Object.keys(b)) {
        if (!(k in a)) {
            removed.push(k)
        }
    }
    added.sort()
    removed.sort()
    changed.sort()
    touched.sort()
    let unchanged = added.length === 0 && removed.length === 0 && changed.length === 0 && touched.length === 0
    return { added, removed, changed, touched, unchanged }
}


export default diffBaselineSnapshots
