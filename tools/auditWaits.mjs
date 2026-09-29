//固定等待盤點(技能 §4.4、§8.1): node node_modules/w-package-tools-e2e/tools/auditWaits.mjs [--only C,E,R] [--json <out>] <專案根目錄...>
//掃描各專案 test/*.test.mjs 與 test/tools/*.mjs 之每個 waitForTimeout(…)(註解行除外)，依其前後語句分類，印統計、各檔分布與清單：
//  A 前一句為偵測(waitFor*、waitUntilExist 等)：偵測後之 settle，允許
//  B 後一句為偵測：轉址前緩衝後接偵測，允許(緩衝本身是否必要另議)
//  L 位於輪詢迴圈內(往前 15 行有 while/for 且其後 8 行內有 if/break/return)：輪詢間隔，允許
//  R 隨即離開函式(下一句為函式宣告、案例物件鍵或 return 結果物件)：同步責任在呼叫端，須看呼叫端
//  C 後一句為截圖/讀取/斷言且前一句非偵測：「固定秒數為唯一同步」候選
//  D 後一句為操作(click、type、goto…)：Locator 操作自帶可操作性等待，多屬允許
//  E 其他：人工判讀
//旗標僅為候選：C／E／R 須逐一判讀「前一動作到預期狀態之間有無非同步來源」——伺服器往返、轉址、後端或前端計時器、廣播同步、防抖——
//有則改為偵測(頁面內條件 waitUntilExist／Locator.waitFor；瀏覽器外結果 pollUntil)；前端同步重繪後之短暫 settle 屬允許。
//另有兩類固定等待不是同步手段而是規格語意，照留：spec 規定之時間(等封鎖到期、「10 秒後仍為連線中」之觀察期)、負向斷言之觀察窗。
//2026-09-28 自 w-web-sso tmp/fixed-wait-classify.mjs 定稿(該日以此盤出 SSO 251 處、PERM 67、API 8、TASK 26)。
//路徑：使用端為 node_modules/w-package-tools-e2e/tools/，套件內為 tools/；用法訊息印實際執行路徑，不綁目錄。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

//本檔相對 cwd 之路徑(用法訊息用; 模組自身位置, 全域 §11.1 場景 B)
let self = path.relative(process.cwd(), fileURLToPath(import.meta.url)).replace(/\\/g, '/')

let argv = process.argv.slice(2)
let only = null
let jsonOut = ''
let roots = []
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') {
        only = String(argv[++i] || '').split(',').filter(Boolean)
    }
    else if (argv[i] === '--json') {
        jsonOut = argv[++i] || ''
    }
    else {
        roots.push(argv[i])
    }
}
if (roots.length === 0) {
    console.error(`usage: node ${self} [--only C,E,R] [--json <out>] <專案根目錄...>`)
    process.exit(2)
}

//偵測類語句(等到某狀態成立才往下)
let reDetect = /waitForFunction|waitUntilExist|pollUntil|waitForSpecState|\.waitFor\(|waitForSelector|waitForURL|waitForResponse|waitForRequest|waitForLoadState|waitForEvent|waitDrawerReady|waitAlertGone|waitGridIdle|waitFor[A-Z]\w*\(|wait[A-Z]\w*(Ready|Settled|Shown|Idle|Gone)\(|toBeVisible|toHaveText|expect\.poll/
let reCapture = /captureStable|screenshot\(/
let reRead = /evaluate\(|innerText|textContent|assert\.|\.select\(|\.url\(\)|count\(\)|isVisible\(|inputValue\(|getAttribute\(|readFile|woItems\./
let reAction = /click\(|dblclick\(|\.type\(|press\(|pressSequentially|insertText|typeInto|fill\(|goto\(|reload\(|hover\(|check\(|mouse\.|keyboard\.|dragTo|selectOption|setInputFiles|close\(\)/

//是否為有意義之語句行: 略過空行、註解、區塊界符; 往前時另略過區塊開頭(if/else/for/while/try 之開括號行)
let isMeaningful = (s, dir) => {
    let t = s.trim()
    if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
        return false
    }
    if (/^[}\])]+[;,]?$/.test(t) || /^}?\s*else\s*{$/.test(t) || /^}?\s*(catch\s*\(.*\)|finally)\s*{$/.test(t) || /^try\s*{$/.test(t)) {
        return false
    }
    if (dir < 0 && /^(}\s*)?(if|else if|for|while)\s*\(.*\)\s*{$/.test(t)) {
        return false
    }
    return true
}

//取 idx 之後(dir=1)或之前(dir=-1)第一個有意義之語句(括號平衡, 至多 6 行 / 8 行)
let stmtAt = (lines, idx, dir) => {
    let i = idx + dir
    while (i >= 0 && i < lines.length && !isMeaningful(lines[i], dir)) {
        i += dir
    }
    if (i < 0 || i >= lines.length) {
        return { line: -1, text: '' }
    }
    let count = (t, a, b) => (t.match(a) || []).length - (t.match(b) || []).length
    let text = lines[i].trim()
    if (dir > 0) {
        let bal = count(text, /\(/g, /\)/g)
        let j = i
        while (bal > 0 && j < i + 6 && j + 1 < lines.length) {
            j++
            let t = lines[j].trim()
            text += ' ' + t
            bal += count(t, /\(/g, /\)/g)
        }
        return { line: i + 1, text }
    }
    let bal = count(text, /\)/g, /\(/g)
    let j = i
    while (bal > 0 && j > i - 8 && j - 1 >= 0) {
        j--
        let t = lines[j].trim()
        text = t + ' ' + text
        bal += count(t, /\)/g, /\(/g)
    }
    return { line: j + 1, text }
}

//是否位於輪詢迴圈內
let inPollLoop = (lines, idx) => {
    let hasLoop = false
    for (let k = idx - 1; k >= Math.max(0, idx - 15); k--) {
        if (/^\s*(while|for)\s*\(/.test(lines[k]) || /\bdo\s*{/.test(lines[k])) {
            hasLoop = true
            break
        }
        if (/^\s*(export\s+)?(async\s+)?function\b|^\s*\w+\s*:\s*async/.test(lines[k])) {
            break
        }
    }
    if (!hasLoop) {
        return false
    }
    for (let k = idx + 1; k < Math.min(lines.length, idx + 8); k++) {
        if (/\bif\s*\(|break|return/.test(lines[k])) {
            return true
        }
    }
    return false
}

let classify = (lines, i) => {
    let prev = stmtAt(lines, i, -1)
    let next = stmtAt(lines, i, 1)
    let leaves = next.line < 0 || /^(export\s+)?(async\s+)?function\b|^\w+\s*:\s*(async\s*)?\(|^(let|const)\s+\w+\s*=\s*(async\s*)?\(.*\)\s*=>|^it\(|^describe\(/.test(next.text) || /^return\s*(\{|$|;|buf\b|r\b|result\b|shots\b|bufs\b)/.test(next.text)
    let cls = ''
    if (inPollLoop(lines, i)) {
        cls = 'L'
    }
    else if (leaves) {
        cls = reDetect.test(prev.text) ? 'A' : 'R'
    }
    else if (reDetect.test(next.text)) {
        cls = 'B'
    }
    else if (reDetect.test(prev.text)) {
        cls = 'A'
    }
    else if (reCapture.test(next.text) || reRead.test(next.text)) {
        cls = 'C'
    }
    else if (reAction.test(next.text)) {
        cls = 'D'
    }
    else {
        cls = 'E'
    }
    return { cls, prev, next }
}

let filesOf = (root) => {
    let r = []
    let testDir = path.resolve(root, 'test')
    if (fs.existsSync(testDir)) {
        for (let f of fs.readdirSync(testDir)) {
            if (f.endsWith('.test.mjs')) {
                r.push(path.join(testDir, f))
            }
        }
    }
    let toolsDir = path.join(testDir, 'tools')
    if (fs.existsSync(toolsDir)) {
        for (let f of fs.readdirSync(toolsDir)) {
            if (f.endsWith('.mjs')) {
                r.push(path.join(toolsDir, f))
            }
        }
    }
    return r
}

let all = []
for (let root of roots) {
    let rows = []
    for (let f of filesOf(root)) {
        let lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
            let s = lines[i]
            if (!/waitForTimeout\(/.test(s) || s.trim().startsWith('//')) {
                continue
            }
            let m = s.match(/waitForTimeout\(([^)]*)\)/)
            let { cls, prev, next } = classify(lines, i)
            rows.push({ root, file: path.relative(root, f).replace(/\\/g, '/'), line: i + 1, dur: m ? m[1].trim() : '?', cls, prev: prev.text.slice(0, 160), next: next.text.slice(0, 160) })
        }
    }
    let counts = {}
    let byFile = {}
    for (let r of rows) {
        counts[r.cls] = (counts[r.cls] || 0) + 1
        byFile[r.file] = byFile[r.file] || {}
        byFile[r.file][r.cls] = (byFile[r.file][r.cls] || 0) + 1
    }
    console.log(`== ${root}`)
    console.log(`total ${rows.length} ${JSON.stringify(counts)}`)
    for (let f of Object.keys(byFile)) {
        console.log(`  ${f.padEnd(44)} ${JSON.stringify(byFile[f])}`)
    }
    for (let r of rows) {
        if (only && !only.includes(r.cls)) {
            continue
        }
        console.log(`[${r.cls}] ${r.file}:${r.line} (${r.dur})\n    prev: ${r.prev}\n    next: ${r.next}`)
    }
    all.push(...rows)
}
if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(all, null, 2))
}
