import crypto from 'crypto'
import maskDiagText from 'wsemi/src/maskDiagText.mjs'
import loadCdnManifest from './loadCdnManifest.mjs'
import { cdnNativeFetch, cdnMimeOf } from './createCdnLocal.mjs'


let RE_URL = /^https?:\/\/[^\s#]+$/

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


function mkErr(msg, extra = {}) {
    let err = new Error(msg)
    err.code = 'E_CDN_GEN'
    return Object.assign(err, extra)
}


//ESM之匯入指定詞(靜態from/import與動態import())
function esmSpecs(text) {
    let out = []
    let re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g
    let m
    while ((m = re.exec(text))) {
        out.push(m[1])
    }
    return out
}


//CSS之@import與url()之指定詞(略過註解、data:與#片段)
function cssSpecs(text) {
    let t = text.replace(/\/\*[\s\S]*?\*\//g, '')
    let out = []
    let re1 = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi
    let re2 = /url\(\s*["']?([^"')]+?)["']?\s*\)/gi
    let m
    while ((m = re1.exec(t))) {
        out.push(m[1])
    }
    while ((m = re2.exec(t))) {
        out.push(m[1])
    }
    return out.filter((s) => !/^(data:|#)/i.test(s))
}


async function mapLimit(items, n, fn) {
    let i = 0
    let worker = async () => {
        while (i < items.length) {
            let k = i++
            await fn(items[k])
        }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}


/**
 * 依根網址清單產生CDN本地副本清單(manifest)：下載根網址，求「相對匯入之閉包」，逐檔算sha256與大小
 *
 * 閉包：副檔名符合opt.esm(預設.mjs)之檔，解析其靜態from、import與動態import()之相對指定詞(./、../、/開頭)；副檔名為.css之檔，解析@import與url()之相對指定詞(略過data:)；
 * 依檔案之網址解析成完整網址後納入，遞迴至無新增。絕對網址(http(s)://)與協定相對網址(//host/x)之指定詞不自動納入——須已在根網址清單或閉包內，否則拋錯(E_CDN_GEN)，請把它列入roots
 * (閉包求不到者不得靜默略過：漏列之外部請求會在測試時被判為違規)；裸指定詞(如'lodash')屬套件解析，不處理。經典(UMD)之.js檔不解析(其內動態載入之資源，由測試時之違規紀錄揭露後補列roots)。
 * 副檔名無法判定內容類型之網址(無副檔名、僅有查詢者，如字型樣式表之css2?family=…)，另記伺服器回應之content-type於清單之type欄，供測試時以同一類型供應。
 * 下載失敗(含HTTP非2xx)重試maxAttempts次(間隔retryDelayMs * 第幾次)，仍失敗即拋錯；產生之清單再經loadCdnManifest檢核。
 * sha256為首次取得時之釘選值：之後之下載一律以其校驗(不符即拒收)；內容隨CDN改版而變者，須重新產生並審視差異(diffCdnManifest)。
 * 需連網，不屬npm test之一部分(使用端之測試只讀清單)。命令列版見tools/genCdnManifest.mjs(含--check重新下載並比對)。
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object|Array} opt.roots 輸入根網址：物件(鍵為使用端自訂之名稱、值為網址)或網址陣列(鍵取網址本身)，必給且不得為空
 * @param {Function} [opt.fetch] 輸入fetch函數，預設為原生fetch
 * @param {Number} [opt.maxAttempts=3] 輸入單檔最多嘗試次數(1至10之整數)，預設3
 * @param {Number} [opt.retryDelayMs=1000] 輸入重試間隔基數毫秒數，預設1000
 * @param {Number} [opt.concurrency=4] 輸入並行下載數(1至16之整數)，預設4
 * @param {RegExp} [opt.esm=/\.mjs$/] 輸入判定為ESM之網址(去查詢與片段後之路徑)樣式，預設/\.mjs$/
 * @param {String} [opt.note] 輸入寫入清單之note字串，預設為固定說明
 * @returns {Promise} 回傳Promise，resolve為清單物件{ schema, note, roots, files }(files依網址排序)
 * @example
 *
 * import genCdnManifest from 'w-package-tools-e2e/src/genCdnManifest.mjs'
 *
 * let m = await genCdnManifest({
 *     roots: {
 *         dagre: 'https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js',
 *         mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs', //其相對匯入之chunk一併納入
 *     },
 * })
 * console.log(Object.keys(m.files).length)
 * // => 100以上
 *
 */
async function genCdnManifest(opt) {
    let o = (opt && typeof opt === 'object') ? opt : {}
    let roots = o.roots
    if (Array.isArray(roots)) {
        roots = Object.fromEntries(roots.map((u) => [u, u]))
    }
    if (!roots || typeof roots !== 'object' || Object.keys(roots).length === 0) {
        throw mkErr('genCdnManifest: opt.roots 須為非空之物件(鍵 → 網址)或網址陣列')
    }
    for (let [k, u] of Object.entries(roots)) {
        if (typeof u !== 'string' || !RE_URL.test(u)) {
            throw mkErr(`genCdnManifest: opt.roots 之網址須為 http(s) 且不含空白與 #(鍵 ${maskDiagText(k)})`)
        }
    }
    let fetchFn = typeof o.fetch === 'function' ? o.fetch : cdnNativeFetch()
    if (!fetchFn) {
        throw mkErr('genCdnManifest: 無可用之 fetch(需 Node 18 以上或傳入 opt.fetch)')
    }
    let maxAttempts = Number.isSafeInteger(o.maxAttempts) && o.maxAttempts >= 1 && o.maxAttempts <= 10 ? o.maxAttempts : 3
    let retryDelayMs = typeof o.retryDelayMs === 'number' && Number.isFinite(o.retryDelayMs) && o.retryDelayMs >= 0 ? o.retryDelayMs : 1000
    let concurrency = Number.isSafeInteger(o.concurrency) && o.concurrency >= 1 && o.concurrency <= 16 ? o.concurrency : 4
    let reEsm = o.esm instanceof RegExp ? o.esm : /\.mjs$/
    let note = typeof o.note === 'string' ? o.note : '由 genCdnManifest 依根網址產生; 網址或版本改變後須重新產生; sha256 為首次取得時之釘選值'

    let get = async (url) => {
        let last = null
        for (let i = 1; i <= maxAttempts; i++) {
            try {
                let res = await fetchFn(url)
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status)
                }
                let type = ''
                try {
                    type = String(res.headers.get('content-type') || '').trim()
                }
                catch (err) {}
                return { buf: Buffer.from(await res.arrayBuffer()), type }
            }
            catch (err) {
                last = err
                if (i < maxAttempts) {
                    await sleep(retryDelayMs * i)
                }
            }
        }
        throw mkErr(`genCdnManifest: 下載失敗 ${maskDiagText(url)}: ${last && last.message}`, { url: maskDiagText(url) })
    }

    let files = {}
    let absolutes = new Set()
    let seen = new Set(Object.values(roots))
    let queue = [...seen]
    while (queue.length) {
        let batch = queue.splice(0)
        await mapLimit(batch, concurrency, async (url) => {
            let { buf, type } = await get(url)
            files[url] = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length }

            //副檔名無法判定內容類型者(無副檔名、僅有查詢)，記下伺服器回應之 content-type，供測試時以同一類型供應(否則 stylesheet、ESM 會因類型不符而靜默壞掉)
            if (type && cdnMimeOf(url) === 'application/octet-stream' && /^[\x20-\x7e]{1,200}$/.test(type)) {
                files[url].type = type
            }
            let p = new URL(url).pathname
            let specs = []
            if (reEsm.test(p)) {
                specs = esmSpecs(buf.toString('utf8'))
            }
            else if (/\.css$/i.test(p)) {
                specs = cssSpecs(buf.toString('utf8'))
            }
            for (let spec of specs) {
                try {
                    if (/^https?:\/\//i.test(spec) || /^\/\//.test(spec)) {

                        //絕對網址與協定相對網址(//host/x，依檔案之網址補協定)：不自動納入，須已在清單內
                        absolutes.add(new URL(spec, url).href.split('#')[0])
                    }
                    else if (/^(\.{1,2}\/|\/(?!\/))/.test(spec)) {
                        let t = new URL(spec, url)
                        t.hash = ''
                        if (!seen.has(t.href)) {
                            seen.add(t.href)
                            queue.push(t.href)
                        }
                    }
                }
                catch (err) {} //無法解析為網址之指定詞(瀏覽器亦無法載入)，不納入
            }
        })
    }
    let have = new Set(Object.keys(files).map((u) => new URL(u).href))
    let lost = [...absolutes].filter((u) => !have.has(u))
    if (lost.length) {
        throw mkErr(`genCdnManifest: 有未列入 roots 之絕對網址匯入(請把它列入 roots): ${lost.slice(0, 5).map((u) => maskDiagText(u)).join(', ')}`, { urls: lost.map((u) => maskDiagText(u)) })
    }
    let sorted = {}
    for (let u of Object.keys(files).sort()) {
        sorted[u] = files[u]
    }
    return loadCdnManifest({ schema: 1, note, roots, files: sorted })
}


/**
 * 比對兩份CDN本地副本清單之差異(供重新產生後審視、或--check判定清單是否仍與線上內容一致)
 *
 * 逐網址比對sha256與大小：只在新清單者為added、只在舊清單者為removed、內容不同者為changed；roots(鍵 → 網址，不計順序)不同者另列一筆type為roots。兩者皆經loadCdnManifest檢核與正規化。
 *
 * @param {Object|String} a 輸入舊清單(物件或JSON檔路徑)
 * @param {Object|String} b 輸入新清單(物件或JSON檔路徑)
 * @returns {Array} 回傳差異陣列[{ type, url }]，type為'added'、'removed'、'changed'或'roots'(roots者無url)；無差異回傳空陣列
 * @example
 *
 * import { diffCdnManifest } from 'w-package-tools-e2e/src/genCdnManifest.mjs'
 *
 * let a = { schema: 1, files: { 'https://x.example/a.js': { sha256: 'a'.repeat(64), size: 1 } } }
 * let b = { schema: 1, files: { 'https://x.example/a.js': { sha256: 'b'.repeat(64), size: 1 } } }
 * console.log(diffCdnManifest(a, b))
 * // => [{ type: 'changed', url: 'https://x.example/a.js' }]
 *
 */
export function diffCdnManifest(a, b) {
    let ma = loadCdnManifest(a)
    let mb = loadCdnManifest(b)
    let out = []
    let urls = [...new Set([...Object.keys(ma.files), ...Object.keys(mb.files)])].sort()
    for (let url of urls) {
        let x = ma.files[url]
        let y = mb.files[url]
        if (!x) {
            out.push({ type: 'added', url })
        }
        else if (!y) {
            out.push({ type: 'removed', url })
        }
        else if (x.sha256 !== y.sha256 || x.size !== y.size || x.type !== y.type) {
            out.push({ type: 'changed', url })
        }
    }
    let norm = (r) => JSON.stringify(Object.entries(r).sort(([k1], [k2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : 0)))
    if (norm(ma.roots) !== norm(mb.roots)) {
        out.push({ type: 'roots' })
    }
    return out
}


export default genCdnManifest
