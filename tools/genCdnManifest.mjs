//產生或核對 CDN 本地副本清單(manifest), 供 createCdnLocal 使用; 需連網, 不屬 npm test 之一部分。
//  node node_modules/w-package-tools-e2e/tools/genCdnManifest.mjs --roots <roots.json|roots.mjs> --out <manifest.json> [--note <文字>] [--concurrency <N>]
//  node node_modules/w-package-tools-e2e/tools/genCdnManifest.mjs --url <網址> [--url <網址> ...] --out <manifest.json>
//  node node_modules/w-package-tools-e2e/tools/genCdnManifest.mjs ... --check      重新下載並與 --out 之現行清單比對, 不同則列出並以離開碼 1 結束(不寫檔)
//  roots 檔: .json 為 { 鍵: 網址 } 物件或網址陣列; .mjs 為 default 或具名匯出 roots(同上形式)。
//  清單之 sha256 為首次取得時之釘選值, 之後之下載一律以其校驗(不符即拒收); 網址或版本改變後須重新執行並審視差異。
//  離開碼: 0 成功(--check 時為一致)、1 失敗或不一致、2 參數錯誤
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import genCdnManifest, { diffCdnManifest } from '../src/genCdnManifest.mjs'
import loadCdnManifest from '../src/loadCdnManifest.mjs'


let args = process.argv.slice(2)
let opt = { urls: [], check: false }
let bad = (msg) => {
    console.error(`genCdnManifest: ${msg}`)
    process.exitCode = 2
}
let needVal = (i) => i + 1 < args.length && !args[i + 1].startsWith('--')
let parsed = true
for (let i = 0; i < args.length; i++) {
    let a = args[i]
    if (a === '--check') {
        opt.check = true
    }
    else if (['--roots', '--out', '--note', '--concurrency', '--url'].includes(a)) {
        if (!needVal(i)) {
            bad(`${a} 缺值`)
            parsed = false
            break
        }
        let v = args[++i]
        if (a === '--url') {
            opt.urls.push(v)
        }
        else {
            opt[a.slice(2)] = v
        }
    }
    else {
        bad(`未知之參數 ${a}`)
        parsed = false
        break
    }
}

if (parsed && !opt.out) {
    bad('須給 --out <manifest.json>')
    parsed = false
}
if (parsed && !opt.roots && opt.urls.length === 0) {
    bad('須給 --roots <檔> 或至少一個 --url <網址>')
    parsed = false
}
if (parsed && opt.roots && opt.urls.length > 0) {
    bad('--roots 與 --url 擇一')
    parsed = false
}
let conc
if (parsed && opt.concurrency !== undefined) {
    conc = Number(opt.concurrency)
    if (!Number.isSafeInteger(conc) || conc < 1 || conc > 16) {
        bad('--concurrency 須為 1 至 16 之整數')
        parsed = false
    }
}

if (parsed) {
    try {
        let roots = opt.urls
        if (opt.roots) {
            let fp = path.resolve(opt.roots)
            if (/\.json$/i.test(fp)) {
                roots = JSON.parse(fs.readFileSync(fp, 'utf8'))
            }
            else {
                let m = await import(pathToFileURL(fp).href)
                roots = m.default !== undefined ? m.default : m.roots
            }
        }
        let gen = { roots }
        if (opt.note !== undefined) {
            gen.note = opt.note
        }
        if (conc !== undefined) {
            gen.concurrency = conc
        }
        let m = await genCdnManifest(gen)
        let n = Object.keys(m.files).length
        let total = Object.values(m.files).reduce((s, e) => s + e.size, 0)
        if (opt.check) {
            let diffs = diffCdnManifest(loadCdnManifest(path.resolve(opt.out)), m)
            if (diffs.length) {
                let label = { added: '新增', removed: '消失', changed: '內容不同', roots: 'roots 不同' }
                console.log(diffs.map((d) => (d.url ? `${label[d.type]} ${d.url}` : label[d.type])).join('\n'))
                process.exitCode = 1
            }
            else {
                console.log(`清單與線上內容一致(${n} 檔)`)
            }
        }
        else {
            fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true })
            fs.writeFileSync(path.resolve(opt.out), JSON.stringify(m, null, 2) + '\n')
            console.log(`已寫出 ${opt.out}: ${Object.keys(m.roots).length} 個根、${n} 檔、${total} 位元組`)
        }
    }
    catch (err) {
        console.error(`genCdnManifest: 失敗: ${err && err.message}`)
        process.exitCode = 1
    }
}
