//比對失敗證據之審查與採用(收集模式單趟執行後用): node node_modules/w-package-tools-e2e/tools/reviewPending.mjs [--pending <dir>] [--since <時間>] [--max-diff <N>] [--crops <dir>] [--json <out>] [--accept <標籤,...>] [--dry-run]
//--since 只看該時刻之後之證據(本趟開始時間, 如 2026-10-28T06:00:00+08:00; 證據目錄永不自動清除, 不給即含前幾趟之殘留)。
//--root 解析相對標準圖路徑之根(預設為案例清單所記比對時之工作目錄; 例: 多開實例之證據要採用回主樹時給主樹根)。
//--crops 之並排裁圖排他建立(已存在加 -N), 永不覆蓋任何既有檔。
//審查(預設; 不改寫任何標準圖)：讀證據目錄(預設 ./testPending)，各標籤取最新一組證據，分類印出——
//  SAME     capture 與證據中之 baseline 副本 RGBA 相同
//  NOISE    pixelmatch 真不同像素數 ≤ --max-diff(預設 100, 同比對端容差)
//  CHANGED  > --max-diff；附差異外框，給 --crops 時另寫並排裁圖(左標準圖、右當次截圖)
//  SIZE     尺寸不同
//  MISSING  缺標準圖(收集模式；capture 即候選標準圖)
//  另列所屬案例(收集模式之案例清單)與案例結果：failed(另因語意斷言等錯誤失敗)者標「不可採用」。
//採用(--accept 明列標籤才執行)：把各標籤之最新 capture 複製為正式標準圖(路徑取自案例清單)；全部標籤先驗證(證據存在、案例未另因錯誤失敗、證據未過期)，
//  任一不過即全部不採用並以離開碼 1 結束；--dry-run 只驗證並印預定之複製清單。採用後只須重跑「另因錯誤失敗」之案例。
//路徑：使用端為 node_modules/w-package-tools-e2e/tools/，套件內為 tools/；用法訊息印實際執行路徑，不綁目錄。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import reviewPendingShots from '../src/reviewPendingShots.mjs'
import acceptPendingShots from '../src/acceptPendingShots.mjs'

//本檔相對 cwd 之路徑(用法訊息用; 模組自身位置, 全域 §11.1 場景 B)
let self = path.relative(process.cwd(), fileURLToPath(import.meta.url)).replace(/\\/g, '/')
let usage = `usage: node ${self} [--pending <dir>] [--since <時間>] [--max-diff <N>] [--crops <dir>] [--json <out>] [--accept <標籤,...>] [--root <dir>] [--dry-run]`

let argv = process.argv.slice(2)
let pendingDir = './testPending'
let since = null
let root
let maxDiffPixels = 100
let cropDir = null
let out = ''
let accept = null
let dryRun = false
let need = (i) => {
    let v = argv[i]
    if (v === undefined || String(v).startsWith('--')) {
        console.error(`${argv[i - 1]} 缺少值\n${usage}`)
        process.exit(2)
    }
    return v
}
for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a === '--pending') {
        pendingDir = need(++i)
    }
    else if (a === '--since') {
        since = need(++i)
    }
    else if (a === '--root') {
        root = need(++i)
    }
    else if (a === '--max-diff') {
        let v = need(++i)
        if (!/^\d+$/.test(v)) {
            console.error(`--max-diff 須為非負整數，實得「${v}」\n${usage}`)
            process.exit(2)
        }
        maxDiffPixels = Number(v)
    }
    else if (a === '--crops') {
        cropDir = need(++i)
    }
    else if (a === '--json') {
        out = need(++i)
    }
    else if (a === '--accept') {
        accept = need(++i).split(',').map((s) => s.trim()).filter(Boolean)
    }
    else if (a === '--dry-run') {
        dryRun = true
    }
    else {
        console.error(`不明參數「${a}」\n${usage}`)
        process.exit(2)
    }
}

let rs = []
try {
    rs = await reviewPendingShots({ pendingDir, maxDiffPixels, cropDir, since })
}
catch (err) {
    console.error(`${err.message}\n${usage}`)
    process.exit(2)
}
let counts = {}
for (let r of rs) {
    counts[r.cls] = (counts[r.cls] || 0) + 1
}
console.log(`[review-pending] ${pendingDir}: ${rs.length} 個標籤 ${Object.keys(counts).sort().map((k) => `${k}=${counts[k]}`).join(' ')}`)
for (let r of rs) {
    let box = r.box ? ` box=${r.box.x},${r.box.y},${r.box.w}x${r.box.h}` : ''
    let num = r.numDiff !== null ? ` diff=${r.numDiff}px` : ''
    let cs = r.caseKey ? ` case=${r.caseKey}(${r.outcome})` : ''
    let ok = r.outcome === 'failed' || r.conflict ? ` 不可採用${r.conflict ? '(清單衝突)' : ''}` : ''
    let side = r.sidePath ? ` side=${r.sidePath}` : ''
    console.log(`${r.cls.padEnd(8)} ${r.label}${num}${box}${cs}${ok}${side}`)
}
if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(rs, null, 2))
}

if (accept) {
    try {
        let plan = await acceptPendingShots({ labels: accept, pendingDir, dryRun, since, ...(root !== undefined ? { root } : {}), log: (s) => console.log(s) })
        if (dryRun) {
            for (let p of plan) {
                console.log(`[accept-dry-run] ${p.label} (${p.cls}) → ${p.to}`)
            }
        }
    }
    catch (err) {
        console.error(err.message)
        process.exit(1)
    }
}
