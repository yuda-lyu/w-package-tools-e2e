import fs from 'fs'
import path from 'path'


//遞迴取最新修改時間之一般檔案; 不跟進連結(symlink、junction), 非一般檔案略過
function newestFile(root, rel, ignore) {
    let best = null
    let walk = (relDir) => {
        let abs = path.join(root, relDir)
        for (let d of fs.readdirSync(abs, { withFileTypes: true })) {
            let r = relDir === '' ? d.name : `${relDir}/${d.name}`
            if (d.isSymbolicLink()) {
                continue
            }
            let shown = rel === '' ? r : `${rel}/${r}`
            //帶 g／y 旗標之 RegExp 之 test 會沿用 lastIndex, 每次歸零
            if (ignore.some((re) => {
                re.lastIndex = 0
                return re.test(shown)
            })) {
                continue
            }
            if (d.isDirectory()) {
                walk(r)
            }
            else if (d.isFile()) {
                let st = fs.lstatSync(path.join(root, r))
                if (!best || st.mtimeMs > best.mtimeMs) {
                    best = { file: shown, mtimeMs: st.mtimeMs }
                }
            }
        }
    }
    walk('')
    return best
}


/**
 * e2e 啟動輔助：dist/ 舊於 src/ 時印清楚之告警(不擋、不拋錯；回傳判定供呼叫端使用)
 *
 * why(排程第 604 項③，2026-11-24)：以後端 serve 已建置之 dist/ 開頁之 e2e 案例讀的是 dist/，src/ 改動未建置進 dist/ 時
 * e2e 看不到改動(不會紅)，要到重建後才紅。本函數比對兩者之「最新修改時間」：src/ 內最新之一般檔案晚於 dist/ 內最新者即判 dist 過期。
 * opt 之非預期輸入(型別不符、空字串、空陣列、非 RegExp)視為未給、改用預設，不拋錯。
 * 判定只依修改時間(建置把 dist/ 寫在 src/ 之後)；git checkout／pull 同時改到兩者時兩者之時間相近、先後不定，可能誤報或漏報(告警不擋即為此)；
 * 要以內容判定者須由建置另寫戳記，不在本函數範圍。不跟進目錄連結；讀取失敗不拋錯，回傳 reason:'error' 並告警。
 * 使用端於 e2e 啟動輔助(例如 startServersOnce 起後端之前)呼叫一次即可；本函數不建置、不改任何檔。
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.projRoot=process.cwd()] 輸入專案根目錄字串，預設process.cwd()
 * @param {String|Array} [opt.srcDirs=['src']] 輸入原始碼目錄字串或其陣列(相對projRoot或絕對)，預設['src']，不存在者略過
 * @param {String} [opt.distDir='dist'] 輸入建置輸出目錄字串(相對projRoot或絕對)，預設'dist'
 * @param {Array} [opt.ignore=[]] 輸入不計入之路徑樣式RegExp陣列，以「目錄參數原字串/相對路徑」(正斜線，例如'src/assets/x.png')比對，預設[]
 * @param {Function} [opt.log=console.warn] 輸入告警輸出函數，預設console.warn；傳null不印
 * @returns {Object} 回傳物件{stale,reason,srcNewest,distNewest}，stale為true(過期或dist不存在)、false(未過期)或null(無從判定)；reason為'stale'、'ok'、'no-dist'、'no-src'、'error'；srcNewest／distNewest為{file,mtimeMs}或null
 * @example
 *
 * import warnDistStale from 'w-package-tools-e2e/src/warnDistStale.mjs'
 *
 * //startServersOnce 起後端(serve dist/)之前
 * warnDistStale({ projRoot, srcDirs: ['src'], distDir: 'dist' })
 * //dist 舊於 src 時印: [dist-stale] dist/ 舊於 src/ …(本告警不擋測試)
 *
 */
function warnDistStale(opt = {}) {
    let {
        projRoot = process.cwd(),
        srcDirs = ['src'],
        distDir = 'dist',
        ignore = [],
        log = console.warn,
    } = opt
    //opt 之非預期輸入視為未給、改用預設(依輸入參數檢測規格 K3; 本函數不擋測試, 亦不因參數拋錯)
    if (typeof projRoot !== 'string' || projRoot.trim() === '') {
        projRoot = process.cwd()
    }
    if (typeof srcDirs === 'string') {
        srcDirs = [srcDirs]
    }
    if (!Array.isArray(srcDirs) || srcDirs.length === 0 || srcDirs.some((s) => typeof s !== 'string' || s.trim() === '')) {
        srcDirs = ['src']
    }
    if (typeof distDir !== 'string' || distDir.trim() === '') {
        distDir = 'dist'
    }
    if (!Array.isArray(ignore) || ignore.some((re) => !(re instanceof RegExp))) {
        ignore = []
    }
    if (log !== null && typeof log !== 'function') {
        log = console.warn
    }
    let say = (s) => {
        if (typeof log === 'function') {
            log(s)
        }
    }
    let norm = (s) => s.replace(/\\/g, '/').replace(/\/+$/, '')
    let fmt = (ms) => new Date(ms).toISOString()
    try {
        let srcNewest = null
        for (let s of srcDirs) {
            let abs = path.resolve(projRoot, s)
            if (!fs.existsSync(abs) || !fs.lstatSync(abs).isDirectory()) {
                continue
            }
            let b = newestFile(abs, norm(s), ignore)
            if (b && (!srcNewest || b.mtimeMs > srcNewest.mtimeMs)) {
                srcNewest = b
            }
        }
        if (!srcNewest) {
            return { stale: null, reason: 'no-src', srcNewest: null, distNewest: null }
        }
        let absDist = path.resolve(projRoot, distDir)
        let distNewest = (fs.existsSync(absDist) && fs.lstatSync(absDist).isDirectory()) ? newestFile(absDist, norm(distDir), ignore) : null
        if (!distNewest) {
            say(`[dist-stale] ${norm(distDir)}/ 不存在或無檔案, 而 ${srcNewest.file} 於 ${fmt(srcNewest.mtimeMs)} 修改; 以後端 serve ${norm(distDir)}/ 開頁之 e2e 將讀不到建置, 請先建置(本告警不擋測試)`)
            return { stale: true, reason: 'no-dist', srcNewest, distNewest: null }
        }
        if (srcNewest.mtimeMs > distNewest.mtimeMs) {
            say(`[dist-stale] ${norm(distDir)}/ 舊於原始碼: ${norm(distDir)}/ 最新 ${fmt(distNewest.mtimeMs)}(${distNewest.file}) < 原始碼最新 ${fmt(srcNewest.mtimeMs)}(${srcNewest.file}); 以後端 serve ${norm(distDir)}/ 開頁之 e2e 看不到其後之原始碼改動(不會紅), 請先建置(本告警不擋測試)`)
            return { stale: true, reason: 'stale', srcNewest, distNewest }
        }
        return { stale: false, reason: 'ok', srcNewest, distNewest }
    }
    catch (err) {
        say(`[dist-stale] 無法比對 ${norm(distDir)}/ 與原始碼之修改時間: ${err && err.message ? err.message : String(err)}(本告警不擋測試)`)
        return { stale: null, reason: 'error', srcNewest: null, distNewest: null }
    }
}


export default warnDistStale
