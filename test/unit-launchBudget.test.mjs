import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath, pathToFileURL } from 'url'
import wpw from 'w-playwright'
import wpte from '../src/WPackageToolsE2e.mjs'
import { INSTALL_BUDGET_MS, LAUNCH_HOOK_TIMEOUT_MS } from '../src/launchBrowser.mjs'
import { stripComments, matchParen } from './tools/srcScan.mjs'


//排程第 636 項 ⑤(本庫 launchBrowser 轉出安裝預算與 before 時限; createCdnLocal 系列不依賴 w-playwright; 本庫測試中啟動瀏覽器之 before 之時限)
//規則帳本: sgud/rule/rulebook_launch.md R-LB-8、sgud/rule/rulebook_cdn.md R-CL-16
//[LH01]～[LH03b]: INSTALL_BUDGET_MS、LAUNCH_HOOK_TIMEOUT_MS 自 w-playwright 轉出(單一事實來源, 不複製字面值、不設備援值)
//[LH04]: createCdnLocal 系列(createCdnLocal、createDirLock、loadCdnManifest、genCdnManifest 與 tools/genCdnManifest.mjs, 含其相對匯入之閉包)不依賴 w-playwright
//[LH05]～[LH06]: 本庫測試中於 before 啟動瀏覽器者, 時限須用 LAUNCH_HOOK_TIMEOUT_MS(盤點器之鑑別力與全庫盤點)
//installTimeout 之接線見 api-launchBrowserWiring [LB13]


//fdSrc、fdTest、fdRoot, 模組自身位置(不依工作目錄)
let fdSrc = fileURLToPath(new URL('../src/', import.meta.url))
let fdTest = fileURLToPath(new URL('./', import.meta.url))
let fdRoot = fileURLToPath(new URL('../', import.meta.url))
let fdTmp = fileURLToPath(new URL('./_tmp/unit-launchBudget/', import.meta.url))


//readCode, 讀檔並去註解
let readCode = (fp) => stripComments(fs.readFileSync(fp, 'utf8'))


//reWpw, 字串中出現 w-playwright(含深層路徑 w-playwright/…、node_modules/w-playwright/…)之判準: 其前為引號或路徑分隔字元、其後為引號或路徑分隔字元(w-playwright-xxx 等相近套件名不算)
let reWpw = /['"`/\\]w-playwright(?:['"`/\\])/


//reCall, 啟動瀏覽器之呼叫: launchBrowser(、launchChromium(、launchChromiumPersistent(, 裸名或帶任意接收者(wpte.launchBrowser(、wpw.launchChromium( 等; 名稱前不得為字元或 $ 以免 relaunchBrowser( 誤判); 屬性取用而非呼叫(後無左括號)不算
let reCall = /(?<![\w$])(?:launchBrowser|launchChromium|launchChromiumPersistent)\s*\(/


//auditLaunchHooks, 盤點一份測試原始碼: 回傳 before(僅 before, 不含 beforeEach)hook 中呼叫啟動瀏覽器者, 逐一標記時限是否為 LAUNCH_HOOK_TIMEOUT_MS
//  時限判定: hook 本體含 this.timeout(<運算式>)(運算式可跨行、含巢狀括號), 其位置在第一個啟動呼叫之前, 且運算式內含識別字 LAUNCH_HOOK_TIMEOUT_MS(單獨、或與 cdn.hookTimeoutMs／CDN_HOOK_TIMEOUT_MS 相加或取較大者皆可)
//  啟發式: 去註解正則＋括號配對, 只盤 hook 本體內「直接」呼叫者(經輔助函數間接啟動者不在範圍, 見帳本限制)
export function auditLaunchHooks(code) {
    let c = stripComments(code)
    let out = []
    let re = /(?<![.\w$])before\s*\(/g
    let m
    while ((m = re.exec(c)) !== null) {
        let open = m.index + m[0].length - 1
        let close = matchParen(c, open)
        let body = close > 0 ? c.slice(open + 1, close) : c.slice(open + 1)
        let call = reCall.exec(body)
        if (!call) {
            continue
        }
        let line = c.slice(0, m.index).split('\n').length
        let limited = false
        let timeoutExpr = null
        let ti = body.search(/this\.timeout\s*\(/)
        if (ti >= 0) {
            let to = body.indexOf('(', ti)
            let tc = matchParen(body, to)
            if (tc > 0) {
                timeoutExpr = body.slice(to + 1, tc).replace(/\s+/g, ' ').trim()
                limited = ti < call.index && /\bLAUNCH_HOOK_TIMEOUT_MS\b/.test(timeoutExpr)
            }
        }
        out.push({ line, limited, timeoutExpr })
    }
    return out
}


//closureOf, 自入口檔起依相對匯入(import／export from、動態 import 之 './…'、'../…')取得之檔案閉包(只含 .mjs／.js, 只走存在者); 裸名套件(如 wsemi/…)不走
function closureOf(entries) {
    let seen = new Set()
    let stack = [...entries]
    while (stack.length > 0) {
        let fp = path.resolve(stack.pop())
        if (seen.has(fp) || !fs.existsSync(fp)) {
            continue
        }
        seen.add(fp)
        let c = readCode(fp)
        for (let mm of c.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
            let next = path.resolve(path.dirname(fp), mm[1])
            if (/\.(mjs|js)$/.test(next)) {
                stack.push(next)
            }
        }
    }
    return [...seen]
}


describe('launchBrowser 之安裝預算與 before 時限(排程第 636 項 ⑤)', function() {

    let seq = 0
    let made = []

    after(function() {
        for (let fp of made) {
            fs.rmSync(fp, { recursive: true, force: true })
        }
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //mkMirror, 建鏡像夾: srcFiles 為要複製之 src 檔(null 表整個 src), 其 node_modules/w-playwright 為假套件(constants 為 null 表不放常數)
    let mkMirror = (srcFiles, constants) => {
        let root = path.join(fdTmp, `mirror-${process.pid}-${++seq}`)
        made.push(root)
        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.mkdirSync(path.join(root, 'node_modules', 'w-playwright'), { recursive: true })
        if (srcFiles === null) {
            fs.cpSync(fdSrc, path.join(root, 'src'), { recursive: true })
        }
        else {
            for (let f of srcFiles) {
                fs.copyFileSync(path.join(fdSrc, f), path.join(root, 'src', f))
            }
        }
        fs.writeFileSync(path.join(root, 'node_modules', 'w-playwright', 'package.json'), JSON.stringify({ name: 'w-playwright', version: '0.0.0-fake', type: 'module', main: 'index.mjs' }))
        fs.writeFileSync(path.join(root, 'node_modules', 'w-playwright', 'index.mjs'), [
            'let calls = []',
            'export default {',
            ...(constants ? [`    INSTALL_BUDGET_MS: ${constants[0]},`, `    LAUNCH_HOOK_TIMEOUT_MS: ${constants[1]},`] : []),
            '    calls,',
            '    launchChromium: async (o) => {',
            '        calls.push(o)',
            '        return { fake: true }',
            '    },',
            '}',
            '',
        ].join('\n'))
        return root
    }
    let load = (root, ...parts) => import(pathToFileURL(path.join(root, ...parts)).href)

    it('[LH01] launchBrowser.mjs 轉出之 INSTALL_BUDGET_MS、LAUNCH_HOOK_TIMEOUT_MS 與 wpw 同值(嚴格相等), 為有限正整數毫秒; 主檔 WPackageToolsE2e 同值; before 時限大於預算、大於 mocha 全域 180 秒', function() {
        //需求: 常數只有 w-playwright 一份, 本庫轉出者與 wpw 同值
        assert.strictEqual(typeof wpw.INSTALL_BUDGET_MS, 'number', 'w-playwright 須提供 INSTALL_BUDGET_MS(^1.0.6)')
        assert.strictEqual(typeof wpw.LAUNCH_HOOK_TIMEOUT_MS, 'number', 'w-playwright 須提供 LAUNCH_HOOK_TIMEOUT_MS(^1.0.6)')
        assert.strictEqual(INSTALL_BUDGET_MS, wpw.INSTALL_BUDGET_MS)
        assert.strictEqual(LAUNCH_HOOK_TIMEOUT_MS, wpw.LAUNCH_HOOK_TIMEOUT_MS)
        assert.strictEqual(wpte.INSTALL_BUDGET_MS, wpw.INSTALL_BUDGET_MS)
        assert.strictEqual(wpte.LAUNCH_HOOK_TIMEOUT_MS, wpw.LAUNCH_HOOK_TIMEOUT_MS)
        for (let v of [INSTALL_BUDGET_MS, LAUNCH_HOOK_TIMEOUT_MS]) {
            assert.ok(Number.isSafeInteger(v) && v > 0 && v <= 2147483647, `須為 1～2147483647 之整數毫秒(mocha 時限上限): ${v}`)
        }
        assert.ok(LAUNCH_HOOK_TIMEOUT_MS > INSTALL_BUDGET_MS, 'before 時限須涵蓋安裝預算並有啟動之餘裕')
        assert.ok(LAUNCH_HOOK_TIMEOUT_MS > 180000, 'before 時限不得沿用 mocha 全域之 180 秒')
    })

    it('[LH02] launchBrowser.mjs 之兩個轉出為單行 export const X = wpw.X(無備援 ??／||、無運算、無字面值), 且各名稱於去註解後之程式碼只出現該行(靜態; 動態證明見 [LH03]、[LH03b])', function() {
        let c = readCode(path.join(fdSrc, 'launchBrowser.mjs'))
        for (let k of ['INSTALL_BUDGET_MS', 'LAUNCH_HOOK_TIMEOUT_MS']) {
            let re = new RegExp(`^export const ${k} = wpw\\.${k}[ \\t]*$`, 'm')
            assert.ok(re.test(c), `${k} 須為單行 export const ${k} = wpw.${k}`)
            assert.strictEqual((c.match(new RegExp(`\\b${k}\\b`, 'g')) || []).length, 2, `${k} 不得另有其他使用或定義(只出現於該匯出句)`)
        }
    })

    it('[LH03] 值真的取自 w-playwright(鏡像證明): 把整個 src 複製到暫存夾並於其 node_modules 放常數為不同值之假 w-playwright, launchBrowser.mjs 與主檔 WPackageToolsE2e 之轉出值隨之為假值、啟動呼叫走假 w-playwright', async function() {
        //非複製之字面值: 若 launchBrowser.mjs 或主檔把常數寫成字面值(含運算式、改寫 wpw 之副本), 轉出值不會隨 w-playwright 改變
        let root = mkMirror(null, [123456, 654321])
        let mod = await load(root, 'src', 'launchBrowser.mjs')
        let main = await load(root, 'src', 'WPackageToolsE2e.mjs')
        let fake = (await load(root, 'node_modules', 'w-playwright', 'index.mjs')).default
        assert.notStrictEqual(wpw.INSTALL_BUDGET_MS, 123456, '夾具之假值須異於真值')
        assert.notStrictEqual(wpw.LAUNCH_HOOK_TIMEOUT_MS, 654321, '夾具之假值須異於真值')
        assert.strictEqual(mod.INSTALL_BUDGET_MS, 123456)
        assert.strictEqual(mod.LAUNCH_HOOK_TIMEOUT_MS, 654321)
        assert.strictEqual(main.default.INSTALL_BUDGET_MS, 123456, '主檔亦須取自 w-playwright(經 launchBrowser 轉出)')
        assert.strictEqual(main.default.LAUNCH_HOOK_TIMEOUT_MS, 654321)
        //確認鏡像之 launchBrowser 解析到的是假 w-playwright(不是向上解析到本庫之真套件)
        let r = await mod.default({ installTimeout: 7 })
        assert.deepStrictEqual(r, { fake: true })
        assert.strictEqual(fake.calls.length, 1)
        assert.strictEqual(fake.calls[0].installTimeout, 7)
    })

    it('[LH03b] 不設備援值(鏡像證明): 假 w-playwright 不提供常數時, 轉出值為 undefined(不得以 ?? 或 || 補一個字面值), 啟動呼叫仍走假 w-playwright', async function() {
        //w-playwright 低於 1.0.6 時常數不存在: 本庫不得以另一份自有數值補上(第二份定義)
        let root = mkMirror(['launchBrowser.mjs', 'chromiumLaunchArgs.mjs'], null)
        let mod = await load(root, 'src', 'launchBrowser.mjs')
        let fake = (await load(root, 'node_modules', 'w-playwright', 'index.mjs')).default
        assert.strictEqual(mod.INSTALL_BUDGET_MS, undefined)
        assert.strictEqual(mod.LAUNCH_HOOK_TIMEOUT_MS, undefined)
        assert.deepStrictEqual(await mod.default({}), { fake: true })
        assert.strictEqual(fake.calls.length, 1)
    })

    it('[LH04] createCdnLocal 系列(createCdnLocal、createDirLock、loadCdnManifest、genCdnManifest、tools/genCdnManifest.mjs)及其相對匯入之閉包不依賴 w-playwright(只依 wsemi; 靜態: 無 import／require／動態 import 或路徑之 w-playwright)', function() {
        //需求(主控已定 2): createCdnLocal 系列不得新增對 w-playwright 之依賴, 只改文件與範例; 其拆出為獨立套件時不帶 w-playwright
        let entries = ['createCdnLocal.mjs', 'createDirLock.mjs', 'loadCdnManifest.mjs', 'genCdnManifest.mjs'].map((f) => path.join(fdSrc, f))
        entries.push(path.join(fdRoot, 'tools', 'genCdnManifest.mjs'))
        for (let fp of entries) {
            assert.ok(fs.existsSync(fp), `盤點對象須存在(防空集合): ${fp}`)
        }
        let files = closureOf(entries)
        assert.ok(files.length >= entries.length, '閉包須含全部入口')
        let hits = []
        for (let fp of files) {
            if (reWpw.test(readCode(fp))) {
                hits.push(path.relative(fdRoot, fp).replace(/\\/g, '/'))
            }
        }
        assert.deepStrictEqual(hits, [])

        //盤點器之鑑別力: 字串判準(含相近套件名不誤判)
        assert.ok(reWpw.test(stripComments('import wpw from \'w-playwright\'\n')))
        assert.ok(reWpw.test(stripComments('let m = await import("w-playwright/src/x.mjs")\n')))
        assert.ok(reWpw.test(stripComments('import x from "./node_modules/w-playwright/src/x.mjs"\n')))
        assert.ok(!reWpw.test(stripComments('import x from \'w-playwright-extra\'\n')))
        assert.ok(!reWpw.test(stripComments('//import wpw from \'w-playwright\'\n/* require("w-playwright") */\n')))

        //盤點器之鑑別力: 閉包確實會走相對匯入(夾具: a → b → c, c 含 w-playwright 者須被找到; 裸名不走; 缺檔不拋)
        let fx = path.join(fdTmp, `closure-${process.pid}-${++seq}`)
        made.push(fx)
        fs.mkdirSync(fx, { recursive: true })
        fs.writeFileSync(path.join(fx, 'a.mjs'), 'import b from \'./b.mjs\'\nimport s from \'wsemi/src/x.mjs\'\nlet m = () => import(\'./missing.mjs\')\n')
        fs.writeFileSync(path.join(fx, 'b.mjs'), 'export { default } from \'./c.mjs\'\n')
        fs.writeFileSync(path.join(fx, 'c.mjs'), 'import wpw from \'w-playwright\'\n')
        let cl = closureOf([path.join(fx, 'a.mjs')]).map((f) => path.basename(f)).sort()
        assert.deepStrictEqual(cl, ['a.mjs', 'b.mjs', 'c.mjs'])
        assert.deepStrictEqual(cl.filter((f) => reWpw.test(readCode(path.join(fx, f)))), ['c.mjs'])
    })

    it('[LH05] auditLaunchHooks 之鑑別力: 只盤 before 內直接呼叫啟動者(launchBrowser、launchChromium、launchChromiumPersistent; 可帶接收者); 時限須在啟動之前且含 LAUNCH_HOOK_TIMEOUT_MS(單獨、相加、取較大者、跨行); 註解、beforeEach、屬性取用、無啟動之 before 不計', function() {
        let L = 'LAUNCH_HOOK_TIMEOUT_MS'
        //未掛時限
        let a = auditLaunchHooks('before(async function() {\n    browser = await launchBrowser()\n})\n')
        assert.deepStrictEqual(a.map((x) => [x.line, x.limited]), [[1, false]])
        //掛了他種時限(沿用 120000、CDN 時限單獨)仍算未掛
        a = auditLaunchHooks('before(async function() {\n    this.timeout(120000)\n    browser = await launchBrowser()\n})\n')
        assert.deepStrictEqual(a.map((x) => x.limited), [false])
        a = auditLaunchHooks('before(async function() {\n    this.timeout(cdn.hookTimeoutMs)\n    browser = await launchBrowser()\n})\n')
        assert.deepStrictEqual(a.map((x) => x.limited), [false])
        //單獨、相加、取較大者、跨行之運算式
        for (let expr of [L, `${L} + cdn.hookTimeoutMs`, `cdn.hookTimeoutMs + ${L}`, `Math.max(${L}, CDN_HOOK_TIMEOUT_MS)`, `\n        Math.max(\n            ${L},\n            CDN_HOOK_TIMEOUT_MS\n        )\n    `]) {
            a = auditLaunchHooks(`before(async function() {\n    this.timeout(${expr})\n    browser = await launchBrowser({ args: [] })\n})\n`)
            assert.deepStrictEqual(a.map((x) => x.limited), [true], expr)
        }
        //時限只出現在註解、字串、this.timeout 之外: 不算
        a = auditLaunchHooks(`before(async function() {\n    //this.timeout(${L})\n    let s = '${L}'\n    browser = await launchBrowser()\n})\n`)
        assert.deepStrictEqual(a.map((x) => x.limited), [false])
        //時限掛在啟動之後(啟動已先用掉全域時限)不算
        a = auditLaunchHooks(`before(async function() {\n    browser = await launchBrowser()\n    this.timeout(${L})\n})\n`)
        assert.deepStrictEqual(a.map((x) => x.limited), [false])
        //帶接收者之啟動(wpte.launchBrowser、wpw.launchChromium、wpw.launchChromiumPersistent)與裸名 launchChromium 皆盤
        for (let call of ['wpte.launchBrowser()', 'wpw.launchChromium({ headless: true })', 'wpw.launchChromiumPersistent(\'\', {})', 'launchChromium()', 'wpte . launchBrowser()']) {
            a = auditLaunchHooks(`before(async function() {\n    x = await ${call}\n})\n`)
            assert.deepStrictEqual(a.map((x) => x.limited), [false], call)
            a = auditLaunchHooks(`before(async function() {\n    this.timeout(${L})\n    x = await ${call}\n})\n`)
            assert.deepStrictEqual(a.map((x) => x.limited), [true], call)
        }
        //不計: 註解中之 before、beforeEach、屬性取用而非呼叫、非啟動之呼叫、無啟動之 before; 箭頭函數亦盤(無 this.timeout 即未限)
        assert.deepStrictEqual(auditLaunchHooks('//before(async function() { await launchBrowser() })\n'), [])
        assert.deepStrictEqual(auditLaunchHooks('beforeEach(async function() {\n    browser = await launchBrowser()\n})\n'), [])
        assert.deepStrictEqual(auditLaunchHooks('before(async function() {\n    let f = wpte.launchBrowser\n    let g = { launch: launchBrowser }\n})\n'), [])
        assert.deepStrictEqual(auditLaunchHooks('before(async function() {\n    x = await relaunchBrowser()\n    y = await startServer()\n})\n'), [])
        a = auditLaunchHooks('before(async () => {\n    browser = await launchBrowser()\n})\n')
        assert.deepStrictEqual(a.map((x) => x.limited), [false])
        //同檔多個 before: 逐一判定與行號
        a = auditLaunchHooks(`describe('a', function() {\n    before(async function() {\n        this.timeout(${L})\n        browser = await launchBrowser()\n    })\n})\ndescribe('b', function() {\n    before(async function() {\n        browser = await launchBrowser()\n    })\n})\n`)
        assert.deepStrictEqual(a.map((x) => [x.line, x.limited]), [[2, true], [8, false]])
    })

    it('[LH06] 本庫測試中於 before 直接啟動瀏覽器者, 時限皆用 LAUNCH_HOOK_TIMEOUT_MS(不沿用 mocha 全域 180 秒或 describe 層之 120 秒); 且盤點範圍非空(至少 7 處)', function() {
        let fps = []
        for (let d of fs.readdirSync(fdTest, { withFileTypes: true })) {
            if (d.isFile() && /\.test\.mjs$/.test(d.name) && d.name !== 'unit-launchBudget.test.mjs') {
                fps.push(path.join(fdTest, d.name))
            }
        }
        let all = []
        for (let fp of fps) {
            for (let h of auditLaunchHooks(fs.readFileSync(fp, 'utf8'))) {
                all.push({ file: path.basename(fp), ...h })
            }
        }
        //防空集合: 本庫現有 e2e 檔於 before 內啟動瀏覽器者至少 7 處(盤點起算之基準; 新增只會更多)
        assert.ok(all.length >= 7, `盤點到之 before 啟動站點過少(盤點器壞掉?): ${all.length}`)
        let bad = all.filter((x) => !x.limited).map((x) => `${x.file}:${x.line}(${x.timeoutExpr === null ? '未掛 this.timeout' : 'this.timeout(' + x.timeoutExpr + ')'})`)
        assert.deepStrictEqual(bad, [], 'before 內啟動瀏覽器者須掛 this.timeout(LAUNCH_HOOK_TIMEOUT_MS)')
    })

})
