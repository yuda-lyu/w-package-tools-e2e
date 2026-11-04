import fs from 'fs'
import path from 'path'


/**
 * 以不跟進連結之方式遞迴列出目錄內之全部連結(符號連結與Windows目錄連結junction)
 *
 * 逐項以fs.lstatSync判定，是連結即記錄且不往下走，故不會列到連結目標內部之連結(dir /AL /S會穿過junction，依其清單拆除會拆到目標內之連結)。
 * 枚舉失敗(權限、路徑過長、目錄不存在)一律拋錯，不得視為沒有連結。root本身為連結時只回傳該連結(rel為空字串)，不往下走
 *
 * @param {String} root 輸入根目錄字串，相對路徑以當下工作目錄解析
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.skip=null] 輸入略過判斷函數(rel, abs)=>Boolean，rel為相對root之路徑(以/分隔)，回傳true者不記錄也不往下走(供略過不複製之路徑)，預設null
 * @returns {Array} 回傳連結陣列，依rel排序，元素為{path,rel,target}，path為絕對路徑，target為連結內容字串(讀取失敗為null)
 * @example
 *
 * import listDirLinks from 'w-package-tools-e2e/src/listDirLinks.mjs'
 *
 * let links = listDirLinks('./tmp/e2e-shards/inst0')
 * console.log(links.map((v) => v.rel))
 * // => ['w-web-perm/node_modules', 'w-web-perm/test/pics']
 *
 */
function listDirLinks(root, opt = {}) {
    if (typeof root !== 'string' || root === '') {
        throw new Error('listDirLinks: root 須為非空字串')
    }
    let skip = opt && typeof opt.skip === 'function' ? opt.skip : null
    let abs = path.resolve(root)
    let readTarget = (p) => {
        try {
            return fs.readlinkSync(p)
        }
        catch (err) {
            return null
        }
    }
    let out = []
    if (fs.lstatSync(abs).isSymbolicLink()) {
        return [{ path: abs, rel: '', target: readTarget(abs) }]
    }
    let walk = (dir) => {
        for (let name of fs.readdirSync(dir)) {
            let p = path.join(dir, name)
            let rel = path.relative(abs, p).replace(/\\/g, '/')
            if (skip && skip(rel, p)) {
                continue
            }
            let st = fs.lstatSync(p)
            if (st.isSymbolicLink()) {
                out.push({ path: p, rel, target: readTarget(p) })
            }
            else if (st.isDirectory()) {
                walk(p)
            }
        }
    }
    walk(abs)
    return out.sort((a, b) => (a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0)))
}


export default listDirLinks
