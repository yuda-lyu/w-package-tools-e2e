import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { stripComments, matchParen } from './tools/srcScan.mjs'


//排程第 604 項①: 本庫所有起子行程之呼叫(child_process 全家)皆須帶 windowsHide: true
//why: 背景(detached、排程、quiet-run)執行之行程沒有主控台, 其再起之子行程未帶 windowsHide 時 Windows 為每個子行程開一個新視窗(全域規範 §8.3)
//盤點範圍: src/、tools/、toolg/ 之程式, 與 test/*.test.mjs、test/tools/*.mjs(測試亦在背景執行); 註解內之文字不算(JSDoc 範例另行人工核對)


const CALL_NAMES = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork', 'spawnSyncFn']


//stripComments(去註解, 保留字串與樣板字面內容)、matchParen(括號配對)移至 test/tools/srcScan.mjs(與 unit-launchBudget 共用, 同一 helper 只定義一次)


//檔內繫結到 child_process 函數之區域名稱: import { a, b as c }、const { a } = require(...)、以及 x = <已繫結名>(預設值、指派之別名, 例: spawnSyncFn = spawnSync、exec = execSync)
//另回傳命名空間名稱(import cp from / import * as cp from / const cp = require(...)), 其 cp.<函數>( 亦盤點
function boundNames(c) {
    let names = new Set()
    let ns = new Set()
    let addList = (s) => {
        for (let part of s.split(',')) {
            let p = part.trim()
            if (!p) {
                continue
            }
            let mm = /^([A-Za-z_$][\w$]*)(?:\s+as\s+|\s*:\s*)?([A-Za-z_$][\w$]*)?$/.exec(p)
            if (mm && CALL_NAMES.includes(mm[1])) {
                names.add(mm[2] || mm[1])
            }
        }
    }
    for (let m of c.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
        addList(m[1])
    }
    for (let m of c.matchAll(/\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
        addList(m[1])
    }
    for (let m of c.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"](?:node:)?child_process['"]/g)) {
        ns.add(m[1])
    }
    for (let m of c.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
        ns.add(m[1])
    }
    //別名: 反覆擴展直到不變
    for (let changed = true; changed;) {
        changed = false
        for (let m of c.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[,;)\n}]/g)) {
            if (names.has(m[2]) && !names.has(m[1])) {
                names.add(m[1])
                changed = true
            }
        }
    }
    return { names, ns }
}


//盤點一份原始碼: 回傳 { inScope, calls:[{ line, name, hidden, text }] }; 檔內(去註解後)無 child_process 者不在範圍; 只盤繫結到 child_process 之名稱
export function auditChildProcHide(code) {
    let c = stripComments(code)
    if (!/child_process/.test(c)) {
        return { inScope: false, calls: [] }
    }
    let { names, ns } = boundNames(c)
    let alts = [...names].map((s) => s.replace(/\$/g, '\\$'))
    for (let n of ns) {
        alts.push(`${n.replace(/\$/g, '\\$')}\\.(?:${CALL_NAMES.join('|')})`)
    }
    let calls = []
    if (alts.length === 0) {
        return { inScope: true, calls }
    }
    let re = new RegExp(`(?<![.\\w$])(${alts.join('|')})\\s*\\(`, 'g')
    let m
    while ((m = re.exec(c)) !== null) {
        //排除函數宣告與定義: function spawn(、async spawn( 等
        let before = c.slice(Math.max(0, m.index - 12), m.index)
        if (/function\s+$/.test(before)) {
            continue
        }
        let open = m.index + m[0].length - 1
        let close = matchParen(c, open)
        let text = close > 0 ? c.slice(open + 1, close) : c.slice(open + 1, open + 400)
        let hidden = /windowsHide\s*:\s*true/.test(text)
        if (!hidden) {
            //選項為識別字者: 同檔內以物件字面定義且含 windowsHide: true 即可(例: const RUN = { ..., windowsHide: true })
            let lastArg = /,\s*([A-Za-z_$][\w$]*)\s*$/.exec(text.trim())
            if (lastArg) {
                let def = new RegExp(`(?:const|let|var)\\s+${lastArg[1]}\\s*=\\s*\\{([\\s\\S]*?)\\}`).exec(c)
                hidden = !!(def && /windowsHide\s*:\s*true/.test(def[1]))
            }
        }
        let line = c.slice(0, m.index).split('\n').length
        calls.push({ line, name: m[1], hidden, text: text.replace(/\s+/g, ' ').slice(0, 120) })
    }
    return { inScope: true, calls }
}


function listFiles() {
    let out = []
    let add = (dir, re, recursive) => {
        if (!fs.existsSync(dir)) {
            return
        }
        for (let d of fs.readdirSync(dir, { withFileTypes: true })) {
            let fp = path.join(dir, d.name)
            if (d.isDirectory() && recursive) {
                add(fp, re, recursive)
            }
            else if (d.isFile() && re.test(d.name)) {
                out.push(fp)
            }
        }
    }
    add(path.resolve('src'), /\.(mjs|cjs|js)$/, true)
    add(path.resolve('tools'), /\.(mjs|cjs|js)$/, true)
    add(path.resolve('toolg'), /\.(mjs|cjs|js)$/, true)
    add(path.resolve('test'), /\.test\.mjs$/, false)
    add(path.resolve('test', 'tools'), /\.(mjs|cjs|js)$/, false)
    //本檔之鑑別力夾具字串刻意含未帶 windowsHide 之呼叫, 不納入
    return out.filter((fp) => path.basename(fp) !== 'unit-childProcHide.test.mjs').sort()
}


describe('child_process 之 windowsHide 盤點(排程第 604 項①)', function() {

    it('[CP-S1] 盤點器之鑑別力: 帶/不帶 windowsHide、識別字選項、註解、RegExp.exec、函數宣告、無 child_process 之檔', function() {
        let head = 'import { spawn, spawnSync, execSync } from \'child_process\'\n'
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'spawn(\'x\', [], { windowsHide: true })').calls.map((x) => x.hidden), [true])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'spawn(\'x\', [], { stdio: \'ignore\' })').calls.map((x) => x.hidden), [false])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'spawnSync(\'x\', [],\n  {\n stdio: \'ignore\',\n windowsHide: true,\n })').calls.map((x) => x.hidden), [true])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'const RUN = { encoding: \'utf8\', windowsHide: true }\nspawnSync(\'x\', [], RUN)').calls.map((x) => x.hidden), [true])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'const RUN = { encoding: \'utf8\' }\nspawnSync(\'x\', [], RUN)').calls.map((x) => x.hidden), [false])
        assert.strict.deepStrictEqual(auditChildProcHide(head + '// spawn(\'x\')\n/* execSync(\'y\') */\nlet m = /a/.exec(s)\nfunction spawnSync(a) {}').calls, [])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'let s = "spawn(\'x\', { stdio: \'ignore\' })"').calls.map((x) => x.hidden), [false])
        assert.strict.deepStrictEqual(auditChildProcHide('spawn(\'x\', [])').inScope, false)
        //別名: 預設值 spawnSyncFn = spawnSync、exec = execSync 之呼叫亦盤點
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'let { spawnSyncFn = spawnSync } = opt\nlet r = spawnSyncFn(a, b, { cwd })').calls.map((x) => [x.name, x.hidden]), [['spawnSyncFn', false]])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'let { exec = execSync } = opt\nexec(`taskkill /PID 123`, { windowsHide: true })').calls.map((x) => [x.name, x.hidden]), [['exec', true]])
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'execSync(`taskkill /F /T /PID (pid)`, { stdio: \'ignore\' })').calls.map((x) => x.hidden), [false])
        //未繫結到 child_process 之同名函數(測試內之包裝)不盤點
        assert.strict.deepStrictEqual(auditChildProcHide(head + 'let exec = (a, b, o) => wrap(a, b, o)\nexec(\'x\', [], o)').calls, [])
        //命名空間與 require
        assert.strict.deepStrictEqual(auditChildProcHide('import cp from \'child_process\'\ncp.spawn(\'x\', [])\ncp.execSync(\'y\', { windowsHide: true })').calls.map((x) => [x.name, x.hidden]), [['cp.spawn', false], ['cp.execSync', true]])
        assert.strict.deepStrictEqual(auditChildProcHide('let code = `const {spawn}=require(\'child_process\');spawn(process.execPath,[],{stdio:\'ignore\'})`').calls.map((x) => x.hidden), [false])
    })

    it('[CP-S2] src/、tools/、toolg/、test/ 之每一處起子行程之呼叫皆帶 windowsHide: true(含 runIsolatedE2e 之兩處)', function() {
        let files = listFiles()
        assert.strict.ok(files.length >= 50, `盤點之檔數過少(${files.length}), 範圍壞了`)
        let all = []
        for (let fp of files) {
            let r = auditChildProcHide(fs.readFileSync(fp, 'utf8'))
            for (let x of r.calls) {
                all.push({ file: path.relative(process.cwd(), fp).replace(/\\/g, '/'), ...x })
            }
        }
        //防空集合: 盤到之呼叫數過少即盤點式壞了
        assert.strict.ok(all.length >= 40, `盤到之呼叫數過少(${all.length}), 盤點式壞了`)
        let ri = all.filter((x) => x.file === 'src/runIsolatedE2e.mjs')
        assert.strict.equal(ri.length, 2, `src/runIsolatedE2e.mjs 應盤到 2 處(實得 ${ri.length})`)
        let bad = all.filter((x) => !x.hidden)
        assert.strict.deepStrictEqual(bad.map((x) => `${x.file}:${x.line} ${x.name}(${x.text})`), [])
    })

})
