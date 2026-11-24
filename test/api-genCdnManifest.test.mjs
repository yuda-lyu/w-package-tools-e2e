import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import loadCdnManifest from '../src/loadCdnManifest.mjs'
import { sha, startServer } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md R-CL-7: tools/genCdnManifest.mjs 命令列(產生、--check、roots 檔、參數錯誤之離開碼)
//  以真實子行程對本機夾具伺服器(回送位址)執行, 不連外網

let CLI = fileURLToPath(new URL('../tools/genCdnManifest.mjs', import.meta.url))
let fdTmp = fileURLToPath(new URL('./_tmp/api-genCdnManifest/', import.meta.url))
let B = (s) => Buffer.from(s)
let n = 0
let dirOf = () => {
    let d = path.join(fdTmp, `c${++n}`)
    fs.mkdirSync(d, { recursive: true })
    return d
}
//非同步起子行程(不可用 spawnSync: 測試行程之事件迴圈被阻塞時, 本機夾具伺服器無法回應子行程之請求而死結)
let run = (args) => new Promise((resolve) => {
    let p = spawn(process.execPath, [CLI, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => {
        stdout += d
    })
    p.stderr.on('data', (d) => {
        stderr += d
    })
    let t = setTimeout(() => p.kill(), 60000)
    p.on('close', (status) => {
        clearTimeout(t)
        resolve({ status, stdout, stderr })
    })
})
let site = () => ({
    '/m/main.mjs': B('import \'./dep.mjs\'\nexport const m = 1\n'),
    '/m/dep.mjs': B('export const d = 1\n'),
    '/m/a.css': B('.a{background:url(./i.png)}\n'),
    '/m/i.png': B('PNG'),
})


describe('api-genCdnManifest', function() {
    this.timeout(120000)

    before(function() {
        fs.mkdirSync(fdTmp, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('[GC01] --url 產生清單: 寫出閉包之清單(含 sha256 與大小), 印出摘要, 離開碼 0; --check 一致 → 0 且不改檔', async function() {
        let bodies = site()
        let srv = await startServer(bodies)
        try {
            let out = path.join(dirOf(), 'sub', 'm.json') //上層資料夾不存在時自動建立
            let r = await run(['--url', srv.baseUrl + '/m/main.mjs', '--url', srv.baseUrl + '/m/a.css', '--out', out])
            assert.strictEqual(r.status, 0, r.stderr)
            assert.ok(/已寫出.*2 個根、4 檔/.test(r.stdout), r.stdout)
            let m = loadCdnManifest(out)
            assert.deepStrictEqual(Object.keys(m.files).sort(), ['/m/a.css', '/m/dep.mjs', '/m/i.png', '/m/main.mjs'].map((p) => srv.baseUrl + p))
            assert.deepStrictEqual(m.files[srv.baseUrl + '/m/i.png'], { sha256: sha(bodies['/m/i.png']), size: 3 })
            let before = fs.statSync(out).mtimeMs
            let r2 = await run(['--url', srv.baseUrl + '/m/main.mjs', '--url', srv.baseUrl + '/m/a.css', '--out', out, '--check'])
            assert.strictEqual(r2.status, 0, r2.stderr + r2.stdout)
            assert.ok(/一致\(4 檔\)/.test(r2.stdout), r2.stdout)
            assert.strictEqual(fs.statSync(out).mtimeMs, before, '--check 不寫檔')
        }
        finally {
            await srv.close()
        }
    })

    it('[GC02] --check 偵測差異: 內容變、檔消失(閉包少一檔)、新增(閉包多一檔)皆離開碼 1 並列出網址, 不改檔; 清單檔不存在亦離開碼 1', async function() {
        let bodies = site()
        let srv = await startServer(bodies)
        try {
            let out = path.join(dirOf(), 'm.json')
            assert.strictEqual((await run(['--url', srv.baseUrl + '/m/main.mjs', '--out', out])).status, 0)
            let saved = fs.readFileSync(out, 'utf8')
            bodies['/m/dep.mjs'] = B('export const d = 2\n') //內容變
            let r = await run(['--url', srv.baseUrl + '/m/main.mjs', '--out', out, '--check'])
            assert.strictEqual(r.status, 1)
            assert.ok(r.stdout.includes('內容不同 ' + srv.baseUrl + '/m/dep.mjs'), r.stdout)
            bodies['/m/main.mjs'] = B('export const m = 1\n') //不再匯入 dep: 閉包少一檔
            let r2 = await run(['--url', srv.baseUrl + '/m/main.mjs', '--out', out, '--check'])
            assert.strictEqual(r2.status, 1)
            assert.ok(r2.stdout.includes('消失 ' + srv.baseUrl + '/m/dep.mjs') && r2.stdout.includes('內容不同 ' + srv.baseUrl + '/m/main.mjs'), r2.stdout)
            bodies['/m/main.mjs'] = B('import \'./dep.mjs\'\nimport \'./extra.mjs\'\n')
            bodies['/m/extra.mjs'] = B('export const e = 1\n')
            let r3 = await run(['--url', srv.baseUrl + '/m/main.mjs', '--out', out, '--check'])
            assert.strictEqual(r3.status, 1)
            assert.ok(r3.stdout.includes('新增 ' + srv.baseUrl + '/m/extra.mjs'), r3.stdout)
            assert.strictEqual(fs.readFileSync(out, 'utf8'), saved, '--check 不改檔')
            let r4 = await run(['--url', srv.baseUrl + '/m/main.mjs', '--out', path.join(dirOf(), 'none.json'), '--check'])
            assert.strictEqual(r4.status, 1)
            assert.ok(/失敗/.test(r4.stderr), r4.stderr)
        }
        finally {
            await srv.close()
        }
    })

    it('[GC03] --roots: .json(物件或陣列)、.mjs(default 匯出或具名匯出 roots)、--note、--concurrency 皆可用', async function() {
        let bodies = site()
        let srv = await startServer(bodies)
        try {
            let dir = dirOf()
            let u = srv.baseUrl + '/m/main.mjs'
            let out = path.join(dir, 'm.json')
            fs.writeFileSync(path.join(dir, 'roots.json'), JSON.stringify({ main: u }))
            assert.strictEqual((await run(['--roots', path.join(dir, 'roots.json'), '--out', out, '--note', '自訂說明', '--concurrency', '2'])).status, 0)
            let m = loadCdnManifest(out)
            assert.deepStrictEqual(m.roots, { main: u })
            assert.strictEqual(m.note, '自訂說明')
            fs.writeFileSync(path.join(dir, 'roots-arr.json'), JSON.stringify([u]))
            let out2 = path.join(dir, 'm2.json')
            assert.strictEqual((await run(['--roots', path.join(dir, 'roots-arr.json'), '--out', out2])).status, 0)
            assert.deepStrictEqual(loadCdnManifest(out2).roots, { [u]: u })
            fs.writeFileSync(path.join(dir, 'roots-def.mjs'), `export default { a: ${JSON.stringify(u)} }\n`)
            fs.writeFileSync(path.join(dir, 'roots-named.mjs'), `export const roots = [${JSON.stringify(u)}]\n`)
            let out3 = path.join(dir, 'm3.json')
            let out4 = path.join(dir, 'm4.json')
            assert.strictEqual((await run(['--roots', path.join(dir, 'roots-def.mjs'), '--out', out3])).status, 0)
            assert.strictEqual((await run(['--roots', path.join(dir, 'roots-named.mjs'), '--out', out4])).status, 0)
            assert.deepStrictEqual(loadCdnManifest(out3).roots, { a: u })
            assert.deepStrictEqual(Object.keys(loadCdnManifest(out4).files), Object.keys(m.files))
        }
        finally {
            await srv.close()
        }
    })

    it('[GC04] 參數錯誤離開碼 2(不連網、不寫檔): 缺 --out、缺根、--roots 與 --url 並用、未知參數、缺值、--concurrency 超出範圍', async function() {
        let dir = dirOf()
        let out = path.join(dir, 'x.json')
        let cases = [
            [['--url', 'http://127.0.0.1:9/a.js'], /--out/],
            [['--out', out], /--roots/],
            [['--out', out, '--roots', 'r.json', '--url', 'http://127.0.0.1:9/a.js'], /擇一/],
            [['--out', out, '--url', 'http://127.0.0.1:9/a.js', '--nope'], /未知/],
            [['--out', out, '--url'], /缺值/],
            [['--out', out, '--url', 'http://127.0.0.1:9/a.js', '--concurrency', '0'], /concurrency/],
            [['--out', out, '--url', 'http://127.0.0.1:9/a.js', '--concurrency', 'x'], /concurrency/],
            [['--out', out, '--url', 'http://127.0.0.1:9/a.js', '--concurrency', '17'], /concurrency/],
        ]
        for (let [args, re] of cases) {
            let r = await run(args)
            assert.strictEqual(r.status, 2, args.join(' ') + ' → ' + r.stdout + r.stderr)
            assert.ok(re.test(r.stderr), r.stderr)
        }
        assert.ok(!fs.existsSync(out))
    })

    it('[GC05] 下載失敗(根網址 404)離開碼 1, 不寫檔(不留半成品)', async function() {
        let srv = await startServer({})
        try {
            let out = path.join(dirOf(), 'fail.json')
            let r = await run(['--url', srv.baseUrl + '/none.js', '--out', out])
            assert.strictEqual(r.status, 1)
            assert.ok(/失敗/.test(r.stderr) && /none\.js/.test(r.stderr), r.stderr)
            assert.ok(!fs.existsSync(out))
        }
        finally {
            await srv.close()
        }
    })

})
