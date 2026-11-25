//srcScan, 原始碼靜態盤點之共用輔助(啟發式: 去註解正則＋括號配對, 非完整 JS 解析器; 供 unit-childProcHide、unit-launchBudget 等盤點型測試共用, 同一 helper 只定義一次)


//stripComments, 去掉 // 與 /* */ 註解(保留字串與樣板字面內容, 以免 -e 之子行程程式碼漏掃); 換行保留以利行號
export function stripComments(code) {
    let out = ''
    let i = 0
    let n = code.length
    while (i < n) {
        let c = code[i]
        let d = code[i + 1]
        if (c === '/' && d === '/') {
            while (i < n && code[i] !== '\n') {
                i++
            }
            continue
        }
        if (c === '/' && d === '*') {
            i += 2
            while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
                out += code[i] === '\n' ? '\n' : ' '
                i++
            }
            i += 2
            continue
        }
        if (c === '\'' || c === '"' || c === '`') {
            let q = c
            out += c
            i++
            while (i < n && code[i] !== q) {
                if (code[i] === '\\') {
                    out += code[i] + (code[i + 1] || '')
                    i += 2
                    continue
                }
                if (q !== '`' && code[i] === '\n') {
                    break
                }
                out += code[i]
                i++
            }
            if (i < n) {
                out += code[i]
                i++
            }
            continue
        }
        out += c
        i++
    }
    return out
}


//matchParen, 自 openIdx(指向 '(')找對應之 ')'; 略過字串內之括號
export function matchParen(code, openIdx) {
    let depth = 0
    for (let i = openIdx; i < code.length; i++) {
        let c = code[i]
        if (c === '\'' || c === '"' || c === '`') {
            let q = c
            i++
            while (i < code.length && code[i] !== q) {
                if (code[i] === '\\') {
                    i++
                }
                i++
            }
            continue
        }
        if (c === '(') {
            depth++
        }
        else if (c === ')') {
            depth--
            if (depth === 0) {
                return i
            }
        }
    }
    return -1
}
