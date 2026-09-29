//標準圖紅框盤點(技能 §7.3、§7.6-3、§8.2): node node_modules/w-package-tools-e2e/tools/auditBoxes.mjs [--out <json>] <pics目錄...>
//掃描各目錄下全部 PNG(遞迴; 排除 _ 開頭之貼圖參考片段)，對每張判定下列六類，印統計與清單並(給 --out 時)寫 JSON：
//  noBox     無框：橫向或縱向 #f26(容差)同色連續長段 < 20px(統計紅像素會被頁面紅字假陽性, 故以長段判定)
//  fullFrame 整張一框：框寬 ≥ 圖寬 95% 且框高 ≥ 圖高 85%(框了等於沒指出任何東西)
//  blank     框內大片空白：框內(內縮 10；扁框高 < 40 者垂直內縮 7)底部連續空白列 ≥ 120px 且 ≥ 框內高 30%，
//            或右側連續空白欄 ≥ 200px 且 ≥ 框內寬 30%(空白＝該列/欄像素與首像素通道差皆 ≤ 6)
//  black     框內遮黑方塊：純黑 (0,0,0) 之 12×12 實心方塊與框重疊(手冊用圖不填黑)
//  touch     紅框壓字：框內緣往內第一條含墨跡(與框內局部底色差 > 48 且非偏紅)之線距內緣 ≤ 2px、墨跡佔比 2%～60%、
//            最長連續段 < 該邊長 25% 且 ≤ 24px(字形筆畫稀疏；元素底色、邊線、勾選框邊屬長段不算)，且該邊未被夾在圖邊(≤ 4px)
//  cut       框線壓到框外內容：框線外緣往外 1～2px 內即有字形墨跡(與框外局部底色差 > 48、同上之稀疏判準)(2026-09-28 加)
//旗標僅為候選：是否缺陷須逐類裁框目視(彈窗面板頂、晶片、圓形按鈕貼框屬元素邊界，非壓字；判準見技能 §7.3-8)。
//2026-09-28 自 w-web-sso tmp/decisions/{redbox,blank-box,blackmask,fullframe,text-touch}-scan.mjs 合併，判準逐字沿用。
//路徑：使用端為 node_modules/w-package-tools-e2e/tools/，套件內為 tools/；用法訊息印實際執行路徑，不綁目錄。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'

//本檔相對 cwd 之路徑(用法訊息用; 模組自身位置, 全域 §11.1 場景 B)
let self = path.relative(process.cwd(), fileURLToPath(import.meta.url)).replace(/\\/g, '/')

let argv = process.argv.slice(2)
let out = ''
let dirs = []
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
        out = argv[++i] || ''
    }
    else {
        dirs.push(argv[i])
    }
}
if (dirs.length === 0) {
    console.error(`usage: node ${self} [--out <json>] <pics目錄...>`)
    process.exit(2)
}

let walk = (dir) => {
    let r = []
    if (!fs.existsSync(dir)) {
        return r
    }
    for (let n of fs.readdirSync(dir)) {
        let p = path.join(dir, n)
        if (fs.statSync(p).isDirectory()) {
            r.push(...walk(p))
        }
        else if (n.endsWith('.png') && !n.startsWith('_')) {
            r.push(p)
        }
    }
    return r
}

let MINRUN = 20
let isRedTol = (d, i) => Math.abs(d[i] - 255) <= 12 && Math.abs(d[i + 1] - 34) <= 24 && Math.abs(d[i + 2] - 102) <= 24
let isF26 = (d, i) => d[i] === 255 && d[i + 1] === 34 && d[i + 2] === 102
let isBlack = (d, i) => d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0
let isReddish = (r, g, b) => r > 150 && r - g > 60 && r - b > 20

let audit = (file) => {
    let png = PNG.sync.read(fs.readFileSync(file))
    let { width: W, height: H, data: d } = png
    let px = (x, y) => {
        let i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]
    }
    let res = { file, width: W, height: H }

    //noBox: 最長紅線
    let bestH = 0
    for (let y = 0; y < H; y++) {
        let run = 0
        for (let x = 0; x < W; x++) {
            run = isRedTol(d, (y * W + x) * 4) ? run + 1 : 0
            if (run > bestH) bestH = run
        }
    }
    let bestV = 0
    for (let x = 0; x < W; x++) {
        let run = 0
        for (let y = 0; y < H; y++) {
            run = isRedTol(d, (y * W + x) * 4) ? run + 1 : 0
            if (run > bestV) bestV = run
        }
    }
    res.noBox = bestH < MINRUN || bestV < MINRUN
    res.redRun = [bestH, bestV]

    //框外接矩形(#f26 純色)與黑像素積分影像
    let S = new Int32Array((W + 1) * (H + 1))
    let b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
    for (let y = 0; y < H; y++) {
        let row = 0
        for (let x = 0; x < W; x++) {
            let i = (y * W + x) * 4
            if (isBlack(d, i)) row++
            if (isF26(d, i)) {
                if (x < b.x0) b.x0 = x
                if (y < b.y0) b.y0 = y
                if (x > b.x1) b.x1 = x
                if (y > b.y1) b.y1 = y
            }
            S[(y + 1) * (W + 1) + (x + 1)] = S[y * (W + 1) + (x + 1)] + row
        }
    }
    if (b.x1 < 0) {
        res.box = null
        return res
    }
    res.box = [b.x0, b.y0, b.x1, b.y1]

    //fullFrame
    res.fullFrame = (b.x1 - b.x0 + 1) / W >= 0.95 && (b.y1 - b.y0 + 1) / H >= 0.85

    //blank
    let TOL = 6
    let INSET = 10
    let same = (i, j) => Math.abs(d[i] - d[j]) <= TOL && Math.abs(d[i + 1] - d[j + 1]) <= TOL && Math.abs(d[i + 2] - d[j + 2]) <= TOL
    let iy = (b.y1 - b.y0) >= 40 ? INSET : 7
    let xa = b.x0 + INSET
    let xb = b.x1 - INSET
    let ya = b.y0 + iy
    let yb = b.y1 - iy
    res.blank = null
    if (xb - xa >= 8 && yb - ya >= 4) {
        let rowBlank = (y) => {
            let i0 = (y * W + xa) * 4; for (let x = xa + 1; x <= xb; x++) {
                if (!same(i0, (y * W + x) * 4)) return false
            } return true
        }
        let colBlank = (x) => {
            let i0 = (ya * W + x) * 4; for (let y = ya + 1; y <= yb; y++) {
                if (!same(i0, (y * W + x) * 4)) return false
            } return true
        }
        let bottom = 0
        for (let y = yb; y >= ya && rowBlank(y); y--) bottom++
        let right = 0
        for (let x = xb; x >= xa && colBlank(x); x--) right++
        let ih = yb - ya + 1
        let iw = xb - xa + 1
        let flagged = (bottom >= 120 && bottom / ih >= 0.3) || (right >= 200 && right / iw >= 0.3)
        res.blank = { bottom, bottomRatio: +(bottom / ih).toFixed(2), right, rightRatio: +(right / iw).toFixed(2), flagged }
    }

    //black
    let BW = 12
    let sum = (x0, y0, x1, y1) => S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]
    let blk = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0 }
    for (let y = 0; y + BW <= H; y += 2) {
        for (let x = 0; x + BW <= W; x += 2) {
            if (sum(x, y, x + BW, y + BW) === BW * BW) {
                if (x < blk.x0) blk.x0 = x
                if (y < blk.y0) blk.y0 = y
                if (x + BW - 1 > blk.x1) blk.x1 = x + BW - 1
                if (y + BW - 1 > blk.y1) blk.y1 = y + BW - 1
                blk.n++
            }
        }
    }
    res.black = blk.n > 0 && !(blk.x1 < b.x0 || blk.x0 > b.x1 || blk.y1 < b.y0 || blk.y0 > b.y1) ? [blk.x0, blk.y0, blk.x1, blk.y1] : null

    //touch
    res.touch = []
    let my = Math.round((b.y0 + b.y1) / 2)
    let mx = Math.round((b.x0 + b.x1) / 2)
    let ix0 = b.x0; while (ix0 < b.x1 && isReddish(...px(ix0, my))) ix0++
    let ix1 = b.x1; while (ix1 > b.x0 && isReddish(...px(ix1, my))) ix1--
    let iy0 = b.y0; while (iy0 < b.y1 && isReddish(...px(mx, iy0))) iy0++
    let iy1 = b.y1; while (iy1 > b.y0 && isReddish(...px(mx, iy1))) iy1--
    if (ix1 - ix0 >= 8 && iy1 - iy0 >= 8) {
        let hist = new Map()
        let addBg = (x, y) => {
            let [r, g, bb] = px(x, y); if (isReddish(r, g, bb)) return; let k = `${r >> 3},${g >> 3},${bb >> 3}`; hist.set(k, (hist.get(k) || 0) + 1)
        }
        for (let x = ix0 + 4; x <= ix1 - 4; x++) {
            addBg(x, iy0 + 1); addBg(x, iy1 - 1)
        }
        for (let y = iy0 + 4; y <= iy1 - 4; y++) {
            addBg(ix0 + 1, y); addBg(ix1 - 1, y)
        }
        let top = [...hist.entries()].sort((p, q) => q[1] - p[1])[0]
        let bg = top ? top[0].split(',').map((v) => Number(v) * 8 + 4) : [255, 255, 255]
        let isInk = (x, y) => {
            let [r, g, bb] = px(x, y); if (isReddish(r, g, bb)) return false; return Math.abs(r - bg[0]) > 48 || Math.abs(g - bg[1]) > 48 || Math.abs(bb - bg[2]) > 48
        }
        let side = (name) => {
            for (let dd = 0; dd <= 12; dd++) {
                let n = 0; let t = 0; let runs = 0; let cur = 0; let maxRun = 0
                let visit = (ink) => {
                    t++; if (ink) {
                        n++; cur++; if (cur === 1) runs++; if (cur > maxRun) maxRun = cur
                    }
                    else cur = 0
                }
                if (name === 'left' || name === 'right') {
                    let x = name === 'left' ? ix0 + dd : ix1 - dd
                    for (let y = iy0 + 6; y <= iy1 - 6; y++) visit(isInk(x, y))
                }
                else {
                    let y = name === 'top' ? iy0 + dd : iy1 - dd
                    for (let x = ix0 + 6; x <= ix1 - 6; x++) visit(isInk(x, y))
                }
                if (n > 0) return { gap: dd, ratio: +(n / t).toFixed(3), runs, maxRun, len: t }
            }
            return { gap: 13, ratio: 0, runs: 0, maxRun: 0, len: 0 }
        }
        let clamped = { left: b.x0 <= 4, top: b.y0 <= 4, right: b.x1 >= W - 5, bottom: b.y1 >= H - 5 }
        for (let k of ['left', 'right', 'top', 'bottom']) {
            let v = side(k)
            if (!clamped[k] && v.gap <= 2 && v.ratio >= 0.02 && v.ratio <= 0.6 && v.maxRun <= Math.min(24, v.len * 0.25)) {
                res.touch.push({ side: k, gap: v.gap, ratio: v.ratio, runs: v.runs, maxRun: v.maxRun })
            }
        }

        //cut：框線外緣緊貼(1～2px 內)字形墨跡 → 框線多半壓到框外之相鄰內容(例：清單緊鄰項之字)
        let hist2 = new Map()
        let addOut = (x, y) => {
            if (x < 0 || y < 0 || x >= W || y >= H) return; let [r, g, bb] = px(x, y); if (isReddish(r, g, bb)) return; let k = `${r >> 3},${g >> 3},${bb >> 3}`; hist2.set(k, (hist2.get(k) || 0) + 1)
        }
        for (let x = b.x0; x <= b.x1; x++) {
            addOut(x, b.y0 - 7); addOut(x, b.y1 + 7)
        }
        for (let y = b.y0; y <= b.y1; y++) {
            addOut(b.x0 - 7, y); addOut(b.x1 + 7, y)
        }
        let top2 = [...hist2.entries()].sort((p, q) => q[1] - p[1])[0]
        let bgOut = top2 ? top2[0].split(',').map((v) => Number(v) * 8 + 4) : [255, 255, 255]
        let isInkOut = (x, y) => {
            if (x < 0 || y < 0 || x >= W || y >= H) return false; let [r, g, bb] = px(x, y); if (isReddish(r, g, bb)) return false; return Math.abs(r - bgOut[0]) > 48 || Math.abs(g - bgOut[1]) > 48 || Math.abs(bb - bgOut[2]) > 48
        }
        let outSide = (name) => {
            for (let dd = 1; dd <= 3; dd++) {
                let n = 0; let t = 0; let runs = 0; let cur = 0; let maxRun = 0
                let visit = (ink) => {
                    t++; if (ink) {
                        n++; cur++; if (cur === 1) runs++; if (cur > maxRun) maxRun = cur
                    }
                    else cur = 0
                }
                if (name === 'left' || name === 'right') {
                    let x = name === 'left' ? b.x0 - dd : b.x1 + dd
                    for (let y = b.y0 + 6; y <= b.y1 - 6; y++) visit(isInkOut(x, y))
                }
                else {
                    let y = name === 'top' ? b.y0 - dd : b.y1 + dd
                    for (let x = b.x0 + 6; x <= b.x1 - 6; x++) visit(isInkOut(x, y))
                }
                if (n > 0) return { gap: dd - 1, ratio: +(n / t).toFixed(3), runs, maxRun, len: t }
            }
            return { gap: 3, ratio: 0, runs: 0, maxRun: 0, len: 0 }
        }
        res.cut = []
        for (let k of ['left', 'right', 'top', 'bottom']) {
            let v = outSide(k)
            if (!clamped[k] && v.gap <= 1 && v.ratio >= 0.02 && v.ratio <= 0.6 && v.maxRun <= Math.min(24, v.len * 0.25)) {
                res.cut.push({ side: k, gap: v.gap, ratio: v.ratio, runs: v.runs, maxRun: v.maxRun })
            }
        }
    }
    return res
}

let files = dirs.flatMap(walk)
let results = files.map(audit)
let cats = {
    noBox: results.filter((r) => r.noBox),
    fullFrame: results.filter((r) => r.fullFrame),
    blank: results.filter((r) => r.blank && r.blank.flagged),
    black: results.filter((r) => r.black),
    touch: results.filter((r) => r.touch && r.touch.length > 0),
    cut: results.filter((r) => r.cut && r.cut.length > 0),
}
console.log(`scanned=${results.length} ` + Object.entries(cats).map(([k, v]) => `${k}=${v.length}`).join(' '))
for (let [k, v] of Object.entries(cats)) {
    for (let r of v) {
        let extra = k === 'blank'
            ? ` bottom=${r.blank.bottom}(${r.blank.bottomRatio}) right=${r.blank.right}(${r.blank.rightRatio})`
            : k === 'touch'
                ? ' ' + r.touch.map((t) => `${t.side}(gap${t.gap},${Math.round(t.ratio * 100)}%,max${t.maxRun})`).join(' ')
                : k === 'cut'
                    ? ' ' + r.cut.map((t) => `${t.side}(gap${t.gap},${Math.round(t.ratio * 100)}%,max${t.maxRun})`).join(' ')
                    : k === 'black' ? ` black=${r.black.join(',')}` : k === 'noBox' ? ` redRun=${r.redRun.join('/')}` : ''
        console.log(`  [${k}] ${path.relative(process.cwd(), r.file)}${extra}`)
    }
}
if (out) {
    fs.writeFileSync(out, JSON.stringify(results, null, 1), 'utf8')
    console.log('→', path.resolve(out))
}
