import fs from 'fs'
import path from 'path'
import http from 'http'
import assert from 'assert'
import { EventEmitter } from 'events'
import getE2eMode from '../src/getE2eMode.mjs'
import createTempSettings from '../src/createTempSettings.mjs'
import registerCleanupHooks from '../src/registerCleanupHooks.mjs'
import probeHttp from '../src/probeHttp.mjs'
import runIsolatedE2e from '../src/runIsolatedE2e.mjs'
import pollUntil from '../src/pollUntil.mjs'


//中介資料落 ./test/_tmp/harnessHelpers (cwd 相對; gitignore), 測完刪除
let fdTmp = path.resolve('./test/_tmp/harnessHelpers')


describe('getE2eMode', function() {

    it('--baseline或E2E_REGEN=1為regen; E2E_STRICT_CAPTURE=1為strict', function() {
        assert.strict.deepStrictEqual(getE2eMode({ argv: ['node', 'x.mjs'], env: {} }), { regen: false, diag: false, strictCapture: false })
        assert.strict.deepStrictEqual(getE2eMode({ argv: ['node', 'x.mjs', '--baseline'], env: {} }).regen, true)
        assert.strict.deepStrictEqual(getE2eMode({ argv: ['node', 'x.mjs'], env: { E2E_REGEN: '1' } }).regen, true)
        assert.strict.deepStrictEqual(getE2eMode({ argv: ['node', 'x.mjs'], env: { E2E_REGEN: '0' } }).regen, false)
        assert.strict.deepStrictEqual(getE2eMode({ argv: [], env: { E2E_STRICT_CAPTURE: '1' } }).strictCapture, true)
    })

    it('診斷閘門: regen且E2E_BARE或E2E_DIAG時拋錯; 非regen時只標diag', function() {
        assert.throws(() => getE2eMode({ argv: ['--baseline'], env: { E2E_BARE: '1' } }), /診斷 env/)
        assert.throws(() => getE2eMode({ argv: [], env: { E2E_REGEN: '1', E2E_DIAG: 'x' } }), /診斷 env/)
        assert.strict.deepStrictEqual(getE2eMode({ argv: [], env: { E2E_DIAG: 'x' } }), { regen: false, diag: true, strictCapture: false })
        assert.strict.deepStrictEqual(getE2eMode({ argv: ['--baseline'], env: { E2E_BARE: '1' }, guard: false }).diag, true)
    })

})


describe('createTempSettings', function() {

    let fpBase = null
    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        fpBase = path.join(fdTmp, 'settings.json')
        //JSON5格式: 無引號鍵、單引號、註解、尾逗號
        fs.writeFileSync(fpBase, ['{', '  //註解', '  serverPort: 11007,', '  language: \'eng\',', '  logFd: \'./logs\',', '}', ''].join('\n'))
    })
    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
    })

    it('以JSON5基底淺合併overrides寫出純JSON, 檔名含pid與序號, cleanup逐檔刪除並刪空目錄', function() {
        let tmpDir = path.join(fdTmp, '_tmp')
        let ts = createTempSettings({ basePath: fpBase, tmpDir })
        let p1 = ts.genTempSettings({ language: 'cht' })
        let p2 = ts.genTempSettings({ extra: { a: 1 } })
        assert.strict.deepStrictEqual(path.basename(p1), `settings-e2e-${process.pid}-0.json`)
        assert.strict.deepStrictEqual(path.basename(p2), `settings-e2e-${process.pid}-1.json`)
        assert.strict.deepStrictEqual(JSON.parse(fs.readFileSync(p1, 'utf8')), { serverPort: 11007, language: 'cht', logFd: './logs' })
        assert.strict.deepStrictEqual(JSON.parse(fs.readFileSync(p2, 'utf8')).extra, { a: 1 })
        assert.strict.deepStrictEqual(ts.files(), [p1, p2])
        ts.cleanupTempSettings()
        assert.strict.deepStrictEqual(fs.existsSync(p1) || fs.existsSync(p2), false)
        assert.strict.deepStrictEqual(fs.existsSync(tmpDir), false)
        assert.strict.deepStrictEqual(ts.files(), [])
    })

    it('目錄內另有他檔時cleanup只刪自己建立者、保留目錄', function() {
        let tmpDir = path.join(fdTmp, '_tmp2')
        fs.mkdirSync(tmpDir, { recursive: true })
        let other = path.join(tmpDir, 'other.json')
        fs.writeFileSync(other, '{}')
        let ts = createTempSettings({ basePath: fpBase, tmpDir })
        let p = ts.genTempSettings({})
        ts.cleanupTempSettings()
        assert.strict.deepStrictEqual(fs.existsSync(p), false)
        assert.strict.deepStrictEqual(fs.existsSync(other), true)
    })

    it('forbiddenKeys不可覆寫', function() {
        let ts = createTempSettings({ basePath: fpBase, tmpDir: path.join(fdTmp, '_tmp3'), forbiddenKeys: ['serverPort', 'logFd'] })
        assert.throws(() => ts.genTempSettings({ serverPort: 1 }), /不可覆寫 serverPort/)
        assert.throws(() => ts.genTempSettings({ logFd: 'x' }), /不可覆寫 logFd/)
        let p = ts.genTempSettings({ language: 'cht' })
        assert.strict.ok(fs.existsSync(p))
        ts.cleanupTempSettings()
    })

    it('basePath/tmpDir必填', function() {
        assert.throws(() => createTempSettings({ tmpDir: 'x' }), /必填/)
        assert.throws(() => createTempSettings({ basePath: 'x' }), /必填/)
    })

})


describe('registerCleanupHooks', function() {

    let fakeProc = () => {
        let p = new EventEmitter()
        p.exits = []
        p.exit = (code) => {
            p.exits.push(code)
        }
        return p
    }

    it('有mocha after時註冊root after(設逾時, 呼叫cleanup), 並註冊exit/SIGINT/SIGTERM', async function() {
        let calls = 0
        let cleanup = () => {
            calls++
        }
        let hooks = []
        let proc = fakeProc()
        let r = registerCleanupHooks(cleanup, { afterTimeoutMs: 12345, proc, globals: { after: (fn) => hooks.push(fn) } })
        assert.strict.deepStrictEqual(r, { mochaAfter: true })
        assert.strict.deepStrictEqual(hooks.length, 1)
        let ctx = {
            t: 0,
            timeout(ms) {
                this.t = ms
            },
        }
        await hooks[0].call(ctx)
        assert.strict.deepStrictEqual(ctx.t, 12345)
        assert.strict.deepStrictEqual(calls, 1)
        proc.emit('exit')
        assert.strict.deepStrictEqual(calls, 2)
        proc.emit('SIGINT')
        proc.emit('SIGTERM')
        assert.strict.deepStrictEqual(calls, 4)
        assert.strict.deepStrictEqual(proc.exits, [130, 143])
    })

    it('無mocha after(直跑)時只註冊process處理器', function() {
        let proc = fakeProc()
        let r = registerCleanupHooks(() => {}, { proc, globals: {} })
        assert.strict.deepStrictEqual(r, { mochaAfter: false })
        assert.strict.deepStrictEqual(proc.listenerCount('exit'), 1)
        assert.strict.deepStrictEqual(proc.listenerCount('SIGINT'), 1)
    })

    it('teardown給定時root after改呼叫teardown(可非同步); 可自訂訊號', async function() {
        let seq = []
        let hooks = []
        let proc = fakeProc()
        registerCleanupHooks(() => seq.push('cleanup'), {
            teardown: async () => {
                seq.push('teardown')
            },
            signals: { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 },
            proc,
            globals: { after: (fn) => hooks.push(fn) },
        })
        await hooks[0].call({ timeout() {} })
        assert.strict.deepStrictEqual(seq, ['teardown'])
        proc.emit('SIGHUP')
        assert.strict.deepStrictEqual(proc.exits, [129])
    })

})


describe('probeHttp', function() {

    let srv = null
    let port = 0
    before(async function() {
        srv = http.createServer((q, s) => {
            if (q.url === '/500') {
                s.statusCode = 500
                s.end('err')
                return
            }
            s.end('{"project":"w-web-sso"}')
        })
        await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
        port = srv.address().port
    })
    after(async function() {
        await new Promise((resolve) => srv.close(resolve))
    })

    it('任何HTTP回應皆為true(含500); 無人監聽為false', async function() {
        assert.strict.deepStrictEqual(await probeHttp(`http://127.0.0.1:${port}/`), true)
        assert.strict.deepStrictEqual(await probeHttp(`http://127.0.0.1:${port}/500`), true)
        let free = http.createServer()
        await new Promise((resolve) => free.listen(0, '127.0.0.1', resolve))
        let freePort = free.address().port
        await new Promise((resolve) => free.close(resolve))
        assert.strict.deepStrictEqual(await probeHttp(`http://127.0.0.1:${freePort}/`), false)
    })

    it('accept可限制狀態碼; identify可驗內文', async function() {
        assert.strict.deepStrictEqual(await probeHttp(`http://127.0.0.1:${port}/500`, { accept: (s) => s < 500 }), false)
        assert.strict.deepStrictEqual(await probeHttp(`http://127.0.0.1:${port}/`, { identify: (t) => t.includes('w-web-sso') }), true)
        assert.strict.deepStrictEqual(await probeHttp(`http://127.0.0.1:${port}/`, { identify: (t) => t.includes('w-web-perm') }), false)
    })

    it('逾時為false', async function() {
        let fetchFn = (url, o) => new Promise((resolve, reject) => {
            o.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
        assert.strict.deepStrictEqual(await probeHttp('http://x/', { timeoutMs: 50, fetchFn }), false)
    })

})


describe('pollUntil', function() {

    it('條件於第N次成立即回傳該truthy值(不再多判斷)', async function() {
        let n = 0
        let v = await pollUntil('第3次成立', async () => {
            n++
            return n >= 3 ? { rows: [n] } : null
        }, { interval: 10 })
        assert.strict.deepStrictEqual(v, { rows: [3] })
        assert.strict.deepStrictEqual(n, 3)
    })

    it('同步函數亦可; 首次即成立不等待', async function() {
        let t0 = Date.now()
        let v = await pollUntil('立即成立', () => 'ok', { interval: 1000 })
        assert.strict.deepStrictEqual(v, 'ok')
        assert.strict.ok(Date.now() - t0 < 500, '首次成立不應睡一個間隔')
    })

    it('判斷拋錯視為未成立並繼續輪詢(紀錄尚不存在而取值失敗之情形)', async function() {
        let n = 0
        let v = await pollUntil('先拋錯後成立', () => {
            n++
            if (n < 3) {
                throw new Error('尚無紀錄')
            }
            return true
        }, { interval: 10 })
        assert.strict.deepStrictEqual(v, true)
        assert.strict.deepStrictEqual(n, 3)
    })

    it('逾時拋錯, 訊息含對象、判斷次數與最後一次錯誤; 不早於逾時亦不大幅超過', async function() {
        let t0 = Date.now()
        await assert.rejects(
            pollUntil('永不成立', () => {
                throw new Error('查無')
            }, { timeout: 150, interval: 20 }),
            (err) => {
                assert.strict.match(err.message, /pollUntil 超過 150ms\(判斷 \d+ 次\)條件仍不成立「永不成立」/)
                assert.strict.match(err.message, /最後一次判斷拋錯: 查無/)
                return true
            }
        )
        let dt = Date.now() - t0
        assert.strict.ok(dt >= 140 && dt < 1000, `耗時應約為逾時, 實際 ${dt}ms`)
    })

    it('回傳falsy(0、空字串、null)皆為未成立; 未拋錯時逾時訊息不附錯誤', async function() {
        let seq = [0, '', null, false]
        let i = 0
        await assert.rejects(
            pollUntil('falsy', () => seq[Math.min(i++, seq.length - 1)], { timeout: 80, interval: 10 }),
            (err) => {
                assert.strict.ok(!err.message.includes('最後一次判斷拋錯'), err.message)
                return true
            }
        )
    })

    it('參數檢核', async function() {
        await assert.rejects(pollUntil('', () => true), /label 須為非空字串/)
        await assert.rejects(pollUntil('x', null), /fn 須為函數/)
        await assert.rejects(pollUntil('x', () => true, { timeout: 0 }), /timeout 須為正數/)
        await assert.rejects(pollUntil('x', () => true, { interval: -1 }), /interval 須為正數/)
    })

})


describe('runIsolatedE2e', function() {

    let testDir = null
    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        testDir = path.join(fdTmp, 'proj', 'test')
        fs.mkdirSync(testDir, { recursive: true })
        for (let f of ['e2e-b.test.mjs', 'e2e-a.test.mjs', 'api-x.test.mjs', 'e2e-c.mjs']) {
            fs.writeFileSync(path.join(testDir, f), '')
        }
    })
    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
    })

    it('依pattern動態列舉並排序, 每檔前呼叫beforeEachFile, 以獨立mocha行程執行, 回傳逐檔結果', async function() {
        let seq = []
        let logs = []
        let spawnSyncFn = (cmd, args, o) => {
            seq.push(['spawn', cmd, args.slice(0, 2), o.cwd])
            return { status: args[1].includes('e2e-b') ? 1 : 0 }
        }
        let projRoot = path.dirname(testDir)
        let r = await runIsolatedE2e({
            projRoot,
            testDir,
            beforeEachFile: async (f) => {
                seq.push(['before', f])
            },
            afterAll: () => {
                seq.push(['afterAll'])
            },
            spawnSyncFn,
            log: (s) => logs.push(s),
        })
        assert.strict.deepStrictEqual(seq, [
            ['before', 'e2e-a.test.mjs'],
            ['spawn', 'npx', ['mocha', path.join('test', 'e2e-a.test.mjs')], projRoot],
            ['before', 'e2e-b.test.mjs'],
            ['spawn', 'npx', ['mocha', path.join('test', 'e2e-b.test.mjs')], projRoot],
            ['afterAll'],
        ])
        assert.strict.deepStrictEqual(r, { results: [{ file: 'e2e-a.test.mjs', code: 0 }, { file: 'e2e-b.test.mjs', code: 1 }], failed: 1 })
        assert.strict.ok(logs.some((s) => s.includes('1 個 e2e 檔失敗')))
    })

    it('mocha參數附於檔案路徑之後(預設--reporter list --timeout 300000)', async function() {
        let got = null
        await runIsolatedE2e({
            projRoot: path.dirname(testDir),
            testDir,
            pattern: /^e2e-a\.test\.mjs$/,
            spawnSyncFn: (cmd, args) => {
                got = args
                return { status: 0 }
            },
            log: () => {},
        })
        assert.strict.deepStrictEqual(got.slice(2), ['--reporter', 'list', '--timeout', '300000'])
    })

    it('projRoot/testDir必填', async function() {
        await assert.rejects(runIsolatedE2e({ testDir }), /必填/)
    })

})
