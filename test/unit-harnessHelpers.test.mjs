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

    //以下為排程第 604 項②(每次判斷之期限): 判斷卡住時不再等它, 整體逾時一到即拋錯; 被放棄者之 signal abort
    //懸置以事件判定: 以 5 秒守門 race 判「有無於逾時拋錯」(修前永久等待), 非以延時同步
    let raceHang = async (p, ms = 5000) => {
        let h = null
        let r = await Promise.race([
            p.then((v) => ({ v }), (err) => ({ err })),
            new Promise((resolve) => {
                h = setTimeout(() => resolve({ hang: true }), ms)
            }),
        ])
        clearTimeout(h)
        return r
    }

    it('[PU-A1] 判斷卡住(永不完成)時於整體逾時拋錯、不等該次判斷, 並abort其signal(未給attemptTimeout、attemptTimeout大於整體逾時兩者皆然)', async function() {
        for (let attemptTimeout of [undefined, 60000]) {
            let sig = null
            let r = await raceHang(pollUntil('卡住', (ctx) => {
                sig = ctx && ctx.signal
                return new Promise(() => {})
            }, { timeout: 200, interval: 20, attemptTimeout }))
            assert.strict.ok(!r.hang, `attemptTimeout=${attemptTimeout}: 應於整體逾時拋錯, 實際懸置`)
            assert.strict.ok(r.err instanceof Error, `attemptTimeout=${attemptTimeout}: 應拋錯`)
            assert.strict.match(r.err.message, /pollUntil 超過 200ms\(判斷 1 次\)條件仍不成立「卡住」；最後一次判斷未於期限內完成\(已放棄等待並 abort 其 signal\)/)
            assert.strict.ok(sig && sig.aborted === true, `attemptTimeout=${attemptTimeout}: 被放棄之判斷其 signal 應已 abort`)
        }
    })

    it('[PU-A2] 判斷於整體逾時之後才完成者不再等: 先拋錯, 其後才完成之truthy值不被回傳', async function() {
        let lateDone = false
        let doneAtReject = null
        let r = await raceHang(pollUntil('慢查詢', () => new Promise((resolve) => {
            setTimeout(() => {
                lateDone = true
                resolve('late')
            }, 1500)
        }), { timeout: 150, interval: 20 }).catch((err) => {
            doneAtReject = lateDone
            throw err
        }))
        assert.strict.ok(r.err instanceof Error, `應拋錯, 實得 ${JSON.stringify(r)}`)
        assert.strict.equal(doneAtReject, false, '拋錯時慢查詢尚未完成(未等它)')
    })

    it('[PU-A3] attemptTimeout: 單次卡住即放棄並續輪詢, 次一次成立即回傳; 被放棄者signal abort, 成立者signal不abort; ctx.attempt 自1遞增', async function() {
        let ctxs = []
        let r = await raceHang(pollUntil('單次期限', (ctx) => {
            ctxs.push(ctx)
            if (ctxs.length === 1) {
                return new Promise(() => {})
            }
            return { ok: ctxs.length }
        }, { timeout: 5000, interval: 10, attemptTimeout: 50 }))
        assert.strict.ok(!r.hang && !r.err, `應成立, 實得 ${r.err ? r.err.message : 'hang'}`)
        assert.strict.deepStrictEqual(r.v, { ok: 2 })
        assert.strict.deepStrictEqual(ctxs.map((c) => c.attempt), [1, 2])
        assert.strict.equal(ctxs[0].signal.aborted, true)
        await new Promise((resolve) => setImmediate(resolve))
        assert.strict.equal(ctxs[1].signal.aborted, false, '成立之判斷其 signal 不得被 abort(回傳值可能仍在讀取本體)')
    })

    it('[PU-A4] 被放棄之判斷於abort後才拋錯者被攔下, 不成為unhandledRejection; 其後判斷照常', async function() {
        let unhandled = []
        let onUnhandled = (reason) => {
            unhandled.push(reason)
        }
        process.on('unhandledRejection', onUnhandled)
        try {
            let n = 0
            let r = await raceHang(pollUntil('abort後拋錯', (ctx) => {
                n++
                if (n === 1) {
                    return new Promise((resolve, reject) => {
                        ctx.signal.addEventListener('abort', () => reject(new Error('aborted later')))
                    })
                }
                return true
            }, { timeout: 5000, interval: 10, attemptTimeout: 30 }))
            assert.strict.ok(!r.hang && !r.err && r.v === true, `應成立, 實得 ${r.err ? r.err.message : JSON.stringify(r)}`)
            await new Promise((resolve) => setTimeout(resolve, 50))
            assert.strict.equal(unhandled.length, 0, 'unhandledRejection 應為 0')
        }
        finally {
            process.removeListener('unhandledRejection', onUnhandled)
        }
    })

    it('[PU-A5] 判斷全數卡住且有attemptTimeout時, 逾時訊息之判斷次數大於1(有續輪詢)且仍於整體逾時拋錯', async function() {
        let sigs = []
        let r = await raceHang(pollUntil('每次皆卡', (ctx) => {
            sigs.push(ctx.signal)
            return new Promise(() => {})
        }, { timeout: 300, interval: 10, attemptTimeout: 40 }))
        assert.strict.ok(r.err instanceof Error, '應拋錯')
        let m = /判斷 (\d+) 次/.exec(r.err.message)
        assert.strict.ok(m && Number(m[1]) >= 2 && Number(m[1]) === sigs.length, r.err.message)
        assert.strict.ok(sigs.every((s) => s.aborted), '每次被放棄之判斷其 signal 皆應 abort')
        assert.strict.match(r.err.message, /最後一次判斷未於期限內完成/)
    })

    it('[PU-A6] attemptTimeout 之非預期輸入(0、負數、字串、NaN、null)視為未給(K3, 不拋錯): 首次卡住即等到整體逾時(不以該值為單次期限)', async function() {
        for (let bad of [0, -1, '50', NaN, null, undefined]) {
            let n = 0
            let r = await raceHang(pollUntil('非預期之單次期限', () => {
                n++
                return n === 1 ? new Promise(() => {}) : 'second'
            }, { timeout: 200, interval: 10, attemptTimeout: bad }))
            assert.strict.ok(r.err instanceof Error && /判斷 1 次/.test(r.err.message), `attemptTimeout=${String(bad)}: 應等到整體逾時(視為未給), 實得 ${r.err ? r.err.message : JSON.stringify(r)}`)
        }
        assert.strict.equal(await pollUntil('x', () => 'v', { attemptTimeout: 'x' }), 'v')
    })

    it('[PU-A8] timeout 為 Infinity 或超過 2^31-1 毫秒時照常輪詢(單次期限夾在計時器上限內, 不致每次約 1ms 即放棄)', async function() {
        for (let timeout of [Infinity, 3e9]) {
            let n = 0
            let r = await raceHang(pollUntil('大逾時', () => new Promise((resolve) => {
                n++
                setTimeout(() => resolve(n >= 2 ? 'ok' : null), 30)
            }), { timeout, interval: 10 }))
            assert.strict.ok(!r.hang && !r.err && r.v === 'ok', `timeout=${timeout}: 應成立, 實得 ${r.err ? r.err.message : JSON.stringify(r)}`)
            assert.strict.equal(n, 2)
        }
    })

    it('[PU-A9] 先拋錯後卡住: 逾時訊息同時註明被放棄與此前之錯誤', async function() {
        let n = 0
        let r = await raceHang(pollUntil('先拋後卡', () => {
            n++
            if (n === 1) {
                throw new Error('第一次錯')
            }
            return new Promise(() => {})
        }, { timeout: 150, interval: 10 }))
        assert.strict.ok(r.err instanceof Error)
        assert.strict.match(r.err.message, /最後一次判斷未於期限內完成\(已放棄等待並 abort 其 signal\)；此前最後一次判斷拋錯: 第一次錯/)
    })

    it('[PU-A7] 期限內完成之判斷行為不變: 拋錯後回傳falsy者, 逾時訊息仍附最後一次錯誤(與改版前同)', async function() {
        let n = 0
        let r = await raceHang(pollUntil('先拋後falsy', () => {
            n++
            if (n === 1) {
                throw new Error('第一次')
            }
            return null
        }, { timeout: 120, interval: 10 }))
        assert.strict.ok(r.err instanceof Error)
        assert.strict.match(r.err.message, /最後一次判斷拋錯: 第一次/)
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

    it('有本地mocha時以node直接執行(不經shell, 正則參數原樣傳入); 無則沿用npx', async function() {
        let projRoot = path.dirname(testDir)
        let bin = path.join(projRoot, 'node_modules', 'mocha', 'bin', 'mocha.js')
        fs.mkdirSync(path.dirname(bin), { recursive: true })
        fs.writeFileSync(bin, '')
        try {
            let got = []
            await runIsolatedE2e({
                projRoot,
                testDir,
                targets: [{ file: 'e2e-b.test.mjs', grep: 'E2E-0(0[2-9]|1[0-5])-' }],
                spawnSyncFn: (cmd, args, o) => {
                    got.push([cmd, args, o.shell])
                    return { status: 0 }
                },
                log: () => {},
            })
            assert.strict.deepStrictEqual(got, [[process.execPath, [bin, path.join('test', 'e2e-b.test.mjs'), '--reporter', 'list', '--timeout', '300000', '--grep', 'E2E-0(0[2-9]|1[0-5])-', '--fail-zero'], false]])
        }
        finally {
            fs.rmSync(path.join(projRoot, 'node_modules'), { recursive: true, force: true })
        }
    })

    it('targets: 依給定順序只跑列出之檔(不用pattern), 有grep者加--grep與--fail-zero, 結果含grep; 檔案不存在即拋錯且一個都不跑', async function() {
        let projRoot = path.dirname(testDir)
        let seq = []
        let logs = []
        let r = await runIsolatedE2e({
            projRoot,
            testDir,
            targets: [{ file: 'e2e-b.test.mjs', grep: 'E2E-004-' }, 'api-x.test.mjs'],
            beforeEachFile: (f) => {
                seq.push(['before', f])
            },
            spawnSyncFn: (cmd, args) => {
                seq.push(['spawn', args.slice(1)])
                return { status: args.includes('E2E-004-') ? 0 : 1 }
            },
            log: (s) => logs.push(s),
        })
        assert.strict.deepStrictEqual(seq, [
            ['before', 'e2e-b.test.mjs'],
            ['spawn', [path.join('test', 'e2e-b.test.mjs'), '--reporter', 'list', '--timeout', '300000', '--grep', 'E2E-004-', '--fail-zero']],
            ['before', 'api-x.test.mjs'],
            ['spawn', [path.join('test', 'api-x.test.mjs'), '--reporter', 'list', '--timeout', '300000']],
        ])
        assert.strict.deepStrictEqual(r, { results: [{ file: 'e2e-b.test.mjs', grep: 'E2E-004-', code: 0 }, { file: 'api-x.test.mjs', code: 1 }], failed: 1 })
        assert.strict.ok(logs.some((s) => s.includes('e2e-b.test.mjs --grep E2E-004-')))
        let called = 0
        await assert.rejects(runIsolatedE2e({
            projRoot,
            testDir,
            targets: ['e2e-a.test.mjs', 'e2e-none.test.mjs'],
            spawnSyncFn: () => {
                called++
                return { status: 0 }
            },
            log: () => {},
        }), /targets 之檔案不存在: e2e-none\.test\.mjs/)
        assert.strict.equal(called, 0)
    })

    it('mochaBin: 相對路徑以projRoot解析為絕對路徑(spawn之cwd為projRoot, projRoot本身為相對路徑亦同); 明確給定而不存在即拋錯且一個都不跑', async function() {
        let projRoot = path.dirname(testDir)
        let binRel = path.join('tools', 'my-mocha.js')
        fs.mkdirSync(path.join(projRoot, 'tools'), { recursive: true })
        fs.writeFileSync(path.join(projRoot, binRel), '')
        try {
            let got = []
            await runIsolatedE2e({
                projRoot: path.relative(process.cwd(), projRoot),
                testDir,
                targets: ['e2e-a.test.mjs'],
                mochaBin: binRel,
                spawnSyncFn: (cmd, args, o) => {
                    got.push([cmd, args.slice(0, 2), o.shell])
                    return { status: 0 }
                },
                log: () => {},
            })
            assert.strict.deepStrictEqual(got, [[process.execPath, [path.join(projRoot, binRel), path.join('test', 'e2e-a.test.mjs')], false]])
        }
        finally {
            fs.rmSync(path.join(projRoot, 'tools'), { recursive: true, force: true })
        }
        let called = 0
        await assert.rejects(runIsolatedE2e({
            projRoot,
            testDir,
            mochaBin: path.join('node_modules', 'none', 'mocha.js'),
            beforeEachFile: () => {
                called++
            },
            spawnSyncFn: () => {
                called++
                return { status: 0 }
            },
            log: () => {},
        }), /mochaBin 不存在/)
        assert.strict.equal(called, 0)
    })

    it('無本地mocha而於Windows經npx(cmd.exe)時: 參數含空白或 " & | < > ^ % 即拋錯且一個都不跑; 無此類字元或非Windows照常以npx執行', async function() {
        let projRoot = path.dirname(testDir)
        let called = 0
        await assert.rejects(runIsolatedE2e({
            projRoot,
            testDir,
            targets: [{ file: 'e2e-a.test.mjs', grep: 'E2E-001-' }, { file: 'e2e-b.test.mjs', grep: 'E2E-0(0[2-9]|1[0-5])-' }],
            platform: 'win32',
            beforeEachFile: () => {
                called++
            },
            spawnSyncFn: () => {
                called++
                return { status: 0 }
            },
            log: () => {},
        }), /會被改寫: E2E-0\(0\[2-9\]\|1\[0-5\]\)-;/)
        assert.strict.equal(called, 0)
        for (let [grep, bad] of [['^E2E-001-', '^E2E-001-'], ['E2E-001 登入', 'E2E-001 登入'], ['a>b', 'a>b'], ['x%OS%y', 'x%OS%y']]) {
            await assert.rejects(runIsolatedE2e({ projRoot, testDir, targets: [{ file: 'e2e-a.test.mjs', grep }], platform: 'win32', spawnSyncFn: () => ({ status: 0 }), log: () => {} }), (err) => {
                assert.strict.ok(err.message.includes(`會被改寫: ${bad};`), err.message)
                return true
            })
        }
        let got = []
        for (let [platform, grep] of [['win32', 'E2E-0(0[2-9])-[a-z]!'], ['linux', '^E2E-0(0[2-9]|1[0-5])-']]) {
            await runIsolatedE2e({
                projRoot,
                testDir,
                targets: [{ file: 'e2e-b.test.mjs', grep }],
                platform,
                spawnSyncFn: (cmd, args, o) => {
                    got.push([cmd, args.slice(-3), o.shell])
                    return { status: 0 }
                },
                log: () => {},
            })
        }
        assert.strict.deepStrictEqual(got, [
            ['npx', ['--grep', 'E2E-0(0[2-9])-[a-z]!', '--fail-zero'], true],
            ['npx', ['--grep', '^E2E-0(0[2-9]|1[0-5])-', '--fail-zero'], false],
        ])
    })

    //排程第 604 項①: 本函數常由背景(detached、排程)腳本呼叫; 無主控台之父行程起子行程而未帶 windowsHide 時 Windows 為其開新視窗
    it('[RI-W1] 起子行程一律帶windowsHide:true(npx兩平台與node直接執行兩條路徑, 含targets與grep); 其餘選項不變', async function() {
        let projRoot = path.dirname(testDir)
        let fdNm = path.join(projRoot, 'node_modules')
        let bin = path.join(fdNm, 'mocha', 'bin', 'mocha.js')
        let got = []
        let spawnSyncFn = (cmd, args, o) => {
            got.push({ cmd: cmd === process.execPath ? 'node' : cmd, windowsHide: o.windowsHide, stdio: o.stdio, cwd: o.cwd, shell: o.shell })
            return { status: 0 }
        }
        fs.rmSync(fdNm, { recursive: true, force: true })
        for (let platform of ['win32', 'linux']) {
            await runIsolatedE2e({ projRoot, testDir, pattern: /^e2e-a\.test\.mjs$/, platform, spawnSyncFn, log: () => {} })
        }
        fs.mkdirSync(path.dirname(bin), { recursive: true })
        fs.writeFileSync(bin, '')
        try {
            await runIsolatedE2e({ projRoot, testDir, targets: ['e2e-a.test.mjs', { file: 'e2e-b.test.mjs', grep: 'E2E-001-' }], spawnSyncFn, log: () => {} })
        }
        finally {
            fs.rmSync(fdNm, { recursive: true, force: true })
        }
        assert.strict.deepStrictEqual(got, [
            { cmd: 'npx', windowsHide: true, stdio: 'inherit', cwd: projRoot, shell: true },
            { cmd: 'npx', windowsHide: true, stdio: 'inherit', cwd: projRoot, shell: false },
            { cmd: 'node', windowsHide: true, stdio: 'inherit', cwd: projRoot, shell: false },
            { cmd: 'node', windowsHide: true, stdio: 'inherit', cwd: projRoot, shell: false },
        ])
    })

})
