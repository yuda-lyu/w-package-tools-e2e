import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'


//工具本身之位置(模組相對, 全域 §11.1 場景 B); 暫存落呼叫端 cwd 之 test/_tmp(場景 A)
let tool = fileURLToPath(new URL('../tools/auditWaits.mjs', import.meta.url))
let fdTmp = path.resolve('./test/_tmp/auditWaits')


//七類各一例(順序即預期分類順序); 註解行之 waitForTimeout 不計
let sample = [
    'async function a(page) {',
    '    await page.waitForFunction(() => true)',
    '    await page.waitForTimeout(500)',
    '    await page.locator(\'x\').click()',
    '}',
    'async function b(page) {',
    '    await page.locator(\'x\').click()',
    '    await page.waitForTimeout(10000)',
    '    await waitUntilExist(page, \'y\', () => true)',
    '}',
    'async function c(page) {',
    '    await page.locator(\'x\').click()',
    '    await page.waitForTimeout(3000)',
    '    let buf = await captureStableWithBox(page, \'.sb\')',
    '    return buf',
    '}',
    'async function d(page) {',
    '    await typeIntoInput(page, x, \'v\')',
    '    await page.waitForTimeout(300)',
    '    await page.locator(\'ok\').click()',
    '}',
    'async function l(page) {',
    '    while (n < 3) {',
    '        await page.waitForTimeout(2500)',
    '        if (done) break',
    '    }',
    '}',
    'async function r(page) {',
    '    await page.locator(\'x\').click()',
    '    await page.waitForTimeout(800)',
    '}',
    'async function nextFn() {}',
    'async function e(page) {',
    '    await page.locator(\'x\').click()',
    '    await page.waitForTimeout(waitMs)',
    '    let y = 1',
    '}',
    '// await page.waitForTimeout(999)',
    '',
].join('\n')


describe('auditWaits(CLI)', function() {

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(path.join(fdTmp, 'proj', 'test', 'tools'), { recursive: true })
        fs.writeFileSync(path.join(fdTmp, 'proj', 'test', 'e2e-sample.test.mjs'), sample)
        //tools 下之共用層亦掃; 非 .mjs 不掃
        fs.writeFileSync(path.join(fdTmp, 'proj', 'test', 'tools', 'e2e-setup.mjs'), 'async function s(page) {\n    await page.waitForSelector(\'x\')\n    await page.waitForTimeout(200)\n    await page.mouse.move(0, 0)\n}\n')
        fs.writeFileSync(path.join(fdTmp, 'proj', 'test', 'tools', 'notes.txt'), 'await page.waitForTimeout(1)\n')
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('依前後語句分出 A/B/C/D/L/R/E; 註解行不計; 變數秒數原樣記錄; tools 下 .mjs 亦掃', function() {
        let out = path.join(fdTmp, 'out.json')
        let r = spawnSync(process.execPath, [tool, '--json', out, path.join(fdTmp, 'proj')], { encoding: 'utf8' })
        assert.strict.equal(r.status, 0, r.stderr)
        let rows = JSON.parse(fs.readFileSync(out, 'utf8'))
        let sampleRows = rows.filter((x) => x.file === 'test/e2e-sample.test.mjs')
        assert.strict.deepStrictEqual(sampleRows.map((x) => x.cls), ['A', 'B', 'C', 'D', 'L', 'R', 'E'])
        assert.strict.deepStrictEqual(sampleRows.map((x) => x.dur), ['500', '10000', '3000', '300', '2500', '800', 'waitMs'])
        let toolRows = rows.filter((x) => x.file === 'test/tools/e2e-setup.mjs')
        assert.strict.deepStrictEqual(toolRows.map((x) => x.cls), ['A'])
        assert.strict.equal(rows.length, 8, '註解行與非 .mjs 檔不應計入')
        assert.strict.match(r.stdout, /total 8 /)
    })

    it('--only 只列指定類別之清單(統計仍為全部)', function() {
        let r = spawnSync(process.execPath, [tool, '--only', 'C', path.join(fdTmp, 'proj')], { encoding: 'utf8' })
        assert.strict.equal(r.status, 0, r.stderr)
        let listed = r.stdout.split(/\r?\n/).filter((s) => /^\[[A-Z]\] /.test(s))
        assert.strict.deepStrictEqual(listed.map((s) => s.slice(0, 3)), ['[C]'])
        assert.strict.match(r.stdout, /e2e-sample\.test\.mjs:13 \(3000\)/)
        assert.strict.match(r.stdout, /total 8 \{"A":2,"B":1,"C":1,"D":1,"L":1,"R":1,"E":1\}/)
    })

    it('未給專案根目錄: 印用法並以 2 結束', function() {
        let r = spawnSync(process.execPath, [tool], { encoding: 'utf8' })
        assert.strict.equal(r.status, 2)
        //用法訊息印實際執行路徑(套件內 tools/…, 使用端 node_modules/w-package-tools-e2e/tools/…), 不綁目錄
        assert.strict.match(r.stderr, /usage: node \S*tools\/auditWaits\.mjs \[--only/)
    })

})
