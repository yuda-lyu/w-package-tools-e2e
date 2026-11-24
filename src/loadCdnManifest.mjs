import fs from 'fs'
import maskDiagText from 'wsemi/src/maskDiagText.mjs'


let RE_URL = /^https?:\/\/[^\s#]+$/
let RE_SHA256 = /^[0-9a-fA-F]{64}$/

//content-type：1 至 200 字之可見 ASCII(含空白，不含控制字元與換行，免回應標頭被注入)，前後空白無意義
let RE_TYPE = /^[\x20-\x7e]{1,200}$/

//網址須為 http(s)、不含空白與 #，且能被 URL 解析(createCdnLocal 以正規化後之網址為比對之鍵)
let isUrl = (u) => typeof u === 'string' && RE_URL.test(u) && URL.canParse(u)


function mkErr(msg, extra = {}) {
    let err = new Error(msg)
    err.code = 'E_CDN_MANIFEST'
    return Object.assign(err, extra)
}


/**
 * 讀取並檢核CDN本地副本清單(manifest)，回傳已正規化之新物件(不與輸入共用參照)
 *
 * 清單格式：{ schema: 1, note?: String, roots?: { 鍵: 網址 }, files: { 網址: { sha256, size, type? } } }。
 * files為「網址 → 內容之釘選值」：網址須為http或https且能被URL解析(不得含空白與#片段，可含?查詢)；sha256為64碼十六進位(大小寫不拘，回傳時一律小寫)；
 * size為非負安全整數(位元組數，0為空檔)；type為選填之content-type(1至200字之可見ASCII)，供副檔名無法判定內容類型之網址(無副檔名、僅有查詢者)使用，未給時依副檔名判定。
 * roots為產生清單時之根網址(鍵為使用端自訂之名稱)，不參與取得與路由，缺省為{}。
 * 清單由genCdnManifest(或tools/genCdnManifest.mjs)依網址清單產生，sha256為首次取得時之釘選值，其後之下載一律以其校驗(不符即拒收)。
 * 給了而不合法者一律拋錯(E_CDN_MANIFEST，fail-closed)：清單決定「什麼內容被信任」，不改用預設；錯誤訊息不回顯sha256，網址經maskDiagText遮蔽。
 *
 * @param {String|Object} input 輸入清單物件，或清單JSON檔之路徑字串
 * @returns {Object} 回傳清單物件{ schema, note, roots, files }，files之各項為{ sha256, size }
 * @example
 *
 * import loadCdnManifest from 'w-package-tools-e2e/src/loadCdnManifest.mjs'
 *
 * let m = loadCdnManifest('./test/tools/cdn.manifest.json')
 * console.log(Object.keys(m.files).length)
 * // => 126
 *
 * let m2 = loadCdnManifest({ schema: 1, files: { 'https://cdn.example.com/a.js': { sha256: 'a'.repeat(64), size: 10 } } })
 * console.log(m2.files['https://cdn.example.com/a.js'].size)
 * // => 10
 *
 */
function loadCdnManifest(input) {
    let m = input
    if (typeof input === 'string') {
        if (input === '') {
            throw mkErr('loadCdnManifest: 清單路徑須為非空字串')
        }
        try {
            m = JSON.parse(fs.readFileSync(input, 'utf8'))
        }
        catch (err) {
            throw mkErr(`loadCdnManifest: 清單檔無法讀取或解析(code ${err && err.code ? err.code : 'PARSE'})`)
        }
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
        throw mkErr('loadCdnManifest: 清單須為物件或清單檔路徑')
    }
    if (m.schema !== 1) {
        throw mkErr('loadCdnManifest: 清單格式不符(schema 須為 1)')
    }
    let roots = {}
    if (m.roots !== undefined && m.roots !== null) {
        if (typeof m.roots !== 'object' || Array.isArray(m.roots)) {
            throw mkErr('loadCdnManifest: roots 須為物件')
        }
        for (let [k, v] of Object.entries(m.roots)) {
            if (!isUrl(v)) {
                throw mkErr(`loadCdnManifest: roots 之項目不合法(鍵 ${maskDiagText(k)})`)
            }
            roots[k] = v
        }
    }
    if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) {
        throw mkErr('loadCdnManifest: files 須為物件(網址 → { sha256, size })')
    }
    let files = {}
    for (let [u, e] of Object.entries(m.files)) {
        let ok = isUrl(u) && !!e && typeof e === 'object' && typeof e.sha256 === 'string' && RE_SHA256.test(e.sha256) && Number.isSafeInteger(e.size) && e.size >= 0
        let hasType = ok && e.type !== undefined && e.type !== null
        if (ok && hasType) {
            ok = typeof e.type === 'string' && RE_TYPE.test(e.type) && e.type.trim() !== ''
        }
        if (!ok) {
            throw mkErr(`loadCdnManifest: files 之項目不合法(網址須為 http(s)、sha256 須為 64 碼十六進位、size 須為非負整數、type 須為 1 至 200 字之可見 ASCII): ${maskDiagText(u)}`, { url: maskDiagText(u) })
        }
        files[u] = { sha256: e.sha256.toLowerCase(), size: e.size }
        if (hasType) {
            files[u].type = e.type.trim()
        }
    }
    return { schema: 1, note: typeof m.note === 'string' ? m.note : '', roots, files }
}


export default loadCdnManifest
