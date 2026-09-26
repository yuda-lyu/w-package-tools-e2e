import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
import { spawn } from 'child_process'


//真實下載與啟動: 以子程序執行test/tools/runLaunchChromium.mjs, 各以空的PLAYWRIGHT_BROWSERS_PATH模擬全新機器(不動本機既有之瀏覽器快取)
//中介資料一律落test/_tmp/launchChromium, 測完刪除

let require = createRequire(import.meta.url)
let fdTmp = path.resolve('./test/_tmp/launchChromium')
let fpRun = path.resolve('./test/tools/runLaunchChromium.mjs')

//expected, 本套件所用Playwright指定之headless shell版本與目錄名
function getExpected() {
    let fpPwPkg = require.resolve('playwright/package.json')
    let fpCorePkg = createRequire(fpPwPkg).resolve('playwright-core/package.json')
    let bs = JSON.parse(fs.readFileSync(path.join(path.dirname(fpCorePkg), 'browsers.json'), 'utf8'))
    let b = bs.browsers.find((v) => v.name === 'chromium-headless-shell')
    return { version: b.browserVersion, dir: `chromium_headless_shell-${b.revision}` }
}

//run, 以指定之瀏覽器目錄執行子程序, 回傳離開碼與全部輸出
function run(fdBrowsers) {
    return new Promise((resolve) => {
        let out = ''
        let cp = spawn(process.execPath, [fpRun], {
            env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: fdBrowsers },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        cp.stdout.on('data', (d) => {
            out += d
        })
        cp.stderr.on('data', (d) => {
            out += d
        })
        cp.on('close', (code) => {
            let line = out.split('\n').find((v) => v.startsWith('RESULT '))
            let result = line ? JSON.parse(line.slice(7)) : null
            resolve({ code, out, result })
        })
    })
}

function countDownloads(out) {
    return (out.match(/Downloading Chrome Headless Shell/g) || []).length
}


describe('launchChromium', function() {

    let expected = null

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        expected = getExpected()
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
    })

    it('全新環境自動下載Playwright指定版本之瀏覽器後啟動', async function() {
        this.timeout(600000)
        let fd = path.join(fdTmp, 'fresh')
        let r = await run(fd)
        assert.strict.deepStrictEqual(r.code, 0, r.out)
        assert.strict.deepStrictEqual(countDownloads(r.out), 1, r.out)
        assert.strict.deepStrictEqual(r.result, { version: expected.version, width: 120 })
        assert.strict.deepStrictEqual(fs.existsSync(path.join(fd, expected.dir)), true)
    })

    it('已安裝時不重複下載, 直接啟動', async function() {
        this.timeout(600000)
        let fd = path.join(fdTmp, 'fresh')
        let r = await run(fd)
        assert.strict.deepStrictEqual(r.code, 0, r.out)
        assert.strict.deepStrictEqual(countDownloads(r.out), 0, r.out)
        assert.strict.deepStrictEqual(r.result, { version: expected.version, width: 120 })
    })

    it('多個程序同時首次啟動只下載一次, 全部啟動成功', async function() {
        this.timeout(600000)
        let fd = path.join(fdTmp, 'parallel')
        let rs = await Promise.all([run(fd), run(fd), run(fd)])
        for (let r of rs) {
            assert.strict.deepStrictEqual(r.code, 0, r.out)
            assert.strict.deepStrictEqual(r.result, { version: expected.version, width: 120 })
        }
        let n = rs.reduce((t, r) => t + countDownloads(r.out), 0)
        assert.strict.deepStrictEqual(n, 1, rs.map((r) => r.out).join('\n----\n'))
    })

})
