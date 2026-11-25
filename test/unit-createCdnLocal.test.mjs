import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import createCdnLocal, { cdnMimeOf, cdnNativeFetch, CDN_BUDGET_MS, CDN_FILE_TOTAL_MS, CDN_LOCK_STALE_MS, CDN_WAIT_MS, CDN_HOOK_TIMEOUT_MS } from '../src/createCdnLocal.mjs'
import loadCdnManifest from '../src/loadCdnManifest.mjs'
import createDirLock from '../src/createDirLock.mjs'
import { HOST, sha, waitUntil, deferred, makeFixture, startServer, deadPid, realFetch, mkCtx, mkBrowser, mkReq, mkRoute } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md(R-CL-1～R-CL-9): 取得流程(夾具伺服器, 不連外網)、鎖之交錯、離線、違規判定、Node 端 fetch 補丁、路由處理器之各分支(替身)
//  取得流程之多行程實測見 api-createCdnLocal.test.mjs, 真瀏覽器見 e2e-createCdnLocal.test.mjs

let fdTmp = fileURLToPath(new URL('./_tmp/createCdnLocal/', import.meta.url))
let n = 0
let dirOf = (name) => path.join(fdTmp, `${name}-${++n}`)
let sums = (b) => Object.keys(b)
let readJournal = (cache) => fs.readFileSync(path.join(cache, 'downloads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
let partsOf = (cache) => fs.readdirSync(cache).filter((f) => /\.part$/.test(f))
let DEAD_URL = 'http://127.0.0.1:1/' //回送位址之關閉埠: 立即連線失敗(不解析網域名稱、不連外網)


describe('unit-createCdnLocal', function() {
    let fx = makeFixture(6) //確定性之夾具(無隨機), 各案不改動其內容

    before(function() {
        fs.mkdirSync(fdTmp, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })


    describe('清單與參數(R-CL-1)', function() {

        it('[CL01] 清單必給且須合法: 缺、schema 不符、sha256／size／網址不合法一律拋錯, 且不回顯 sha256', function() {
            for (let bad of [undefined, null]) {
                assert.throws(() => createCdnLocal({ manifest: bad }), (err) => err.code === 'E_CDN_ARG', 'manifest 缺')
            }
            assert.throws(() => createCdnLocal(), (err) => err.code === 'E_CDN_ARG')
            let ok = { sha256: 'a'.repeat(64), size: 1 }
            let u = 'https://x.invalid/a.js'
            let cases = [
                [{ schema: 2, files: {} }, /schema/],
                [{ schema: 1 }, /files/],
                [{ schema: 1, files: [] }, /files/],
                [{ schema: 1, files: { [u]: { ...ok, sha256: 'abc' } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, sha256: 'g'.repeat(64) } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, size: -1 } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, size: 1.5 } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, size: '5' } } }, /不合法/],
                [{ schema: 1, files: { [u]: null } }, /不合法/],
                [{ schema: 1, files: { 'x.invalid/a.js': ok } }, /不合法/],
                [{ schema: 1, files: { 'ftp://x.invalid/a.js': ok } }, /不合法/],
                [{ schema: 1, files: { 'https://x.invalid/a.js#frag': ok } }, /不合法/],
                [{ schema: 1, files: { 'https://x.invalid/a b.js': ok } }, /不合法/],
                [{ schema: 1, roots: [], files: {} }, /roots/],
                [{ schema: 1, roots: { k: 'nope' }, files: {} }, /roots/],
                ['not-an-object', /清單檔/],
                [[], /物件/],
                [{ schema: 1, files: { [u]: { ...ok, type: 5 } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, type: '' } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, type: '   ' } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, type: 'text/css\r\nx-evil: 1' } } }, /不合法/],
                [{ schema: 1, files: { [u]: { ...ok, type: 'a'.repeat(201) } } }, /不合法/],
                [{ schema: 1, files: { 'https://[::1/a.js': ok } }, /不合法/],
            ]
            for (let [m, re] of cases) {
                assert.throws(() => createCdnLocal({ manifest: m }), (err) => err.code === 'E_CDN_MANIFEST' && re.test(err.message) && !/a{20}/.test(err.message), JSON.stringify(m).slice(0, 80))
            }
        })

        it('[CL02] 清單接受大小寫之 sha256(轉小寫)、size 0(空檔)、含查詢字串之網址, 也可給 JSON 檔路徑; 載入後不與輸入共用參照', function() {
            let raw = { schema: 1, files: { 'https://x.invalid/a.js?v=1': { sha256: 'AB'.repeat(32), size: 0 } } }
            let m = loadCdnManifest(raw)
            assert.strictEqual(m.files['https://x.invalid/a.js?v=1'].sha256, 'ab'.repeat(32))
            assert.strictEqual(m.files['https://x.invalid/a.js?v=1'].size, 0)
            assert.deepStrictEqual(m.roots, {})
            raw.files['https://x.invalid/a.js?v=1'].size = 99 //載入後改輸入不影響
            assert.strictEqual(m.files['https://x.invalid/a.js?v=1'].size, 0)
            let fp = path.join(dirOf('manifest'), 'm.json')
            fs.mkdirSync(path.dirname(fp), { recursive: true })
            fs.writeFileSync(fp, JSON.stringify(fx.manifest))
            let cdn = createCdnLocal({ manifest: fp, cacheDir: path.join(path.dirname(fp), 'cache') })
            assert.strictEqual(cdn.stats().files, 6)
            assert.throws(() => loadCdnManifest(path.join(path.dirname(fp), 'nope.json')), (err) => err.code === 'E_CDN_MANIFEST' && /清單檔/.test(err.message))
            fs.writeFileSync(fp, '{bad json')
            assert.throws(() => loadCdnManifest(fp), (err) => err.code === 'E_CDN_MANIFEST')
        })

        it('[CL02b] 清單項目之 type(選填 content-type): 保留並去前後空白, null 視為未給; 清單之鍵正規化後相同者須內容一致(一致則併為一項, 矛盾拋 E_CDN_MANIFEST)', function() {
            let m = loadCdnManifest({
                schema: 1,
                files: {
                    'https://x.invalid/css2?family=A': { sha256: 'a'.repeat(64), size: 3, type: ' text/css; charset=utf-8 ' },
                    'https://x.invalid/b': { sha256: 'b'.repeat(64), size: 3, type: null },
                    'https://x.invalid/c': { sha256: 'c'.repeat(64), size: 3 },
                }
            })
            assert.deepStrictEqual(m.files['https://x.invalid/css2?family=A'], { sha256: 'a'.repeat(64), size: 3, type: 'text/css; charset=utf-8' })
            assert.deepStrictEqual(m.files['https://x.invalid/b'], { sha256: 'b'.repeat(64), size: 3 })
            assert.ok(!('type' in m.files['https://x.invalid/c']))
            let e = { sha256: 'd'.repeat(64), size: 1 }
            let same = createCdnLocal({ manifest: { schema: 1, files: { 'https://CDN.x.invalid:443/a.js': e, 'https://cdn.x.invalid/a.js': e } }, cacheDir: dirOf('canon') })
            assert.strictEqual(same.stats().files, 1, '正規化後相同且內容一致者併為一項')
            assert.deepStrictEqual(same.lookup('https://cdn.x.invalid/a.js'), e)
            assert.deepStrictEqual(same.lookup('HTTPS://CDN.X.INVALID:443/a.js#frag'), e, '請求網址同樣先正規化')
            assert.throws(() => createCdnLocal({ manifest: { schema: 1, files: { 'https://CDN.x.invalid:443/a.js': e, 'https://cdn.x.invalid/a.js': { ...e, size: 2 } } }, cacheDir: dirOf('canon') }), (err) => err.code === 'E_CDN_MANIFEST')
            assert.throws(() => createCdnLocal({ manifest: { schema: 1, files: { 'https://CDN.x.invalid:443/a.js': e, 'https://cdn.x.invalid/a.js': { ...e, type: 'text/css' } } }, cacheDir: dirOf('canon') }), (err) => err.code === 'E_CDN_MANIFEST', 'type 不同亦矛盾')
        })

        it('[CL03] 安全相關 opt(cacheDir、allow)給了而無效即拋 E_CDN_ARG; 其餘 opt 非預期之輸入視為未給(取預設)', function() {
            for (let bad of ['', 5, {}, [], true, 'a\0b']) {
                assert.throws(() => createCdnLocal({ manifest: fx.manifest, cacheDir: bad }), (err) => err.code === 'E_CDN_ARG', 'cacheDir=' + String(bad))
            }
            for (let bad of ['x', {}, [1], ['https://a'], [null], 5, true]) {
                assert.throws(() => createCdnLocal({ manifest: fx.manifest, allow: bad }), (err) => err.code === 'E_CDN_ARG', 'allow=' + JSON.stringify(bad))
            }
            let d = createCdnLocal({ manifest: fx.manifest })
            assert.strictEqual(d.cacheDir, path.resolve('test', '_cache', 'cdn'), '未給 cacheDir 取 cwd 下 test/_cache/cdn')
            for (let bad of [0, -1, NaN, Infinity, 'x', null, {}, 2 ** 31, true]) {
                let c = createCdnLocal({ manifest: fx.manifest, budgetMs: bad, fileTimeoutMs: bad, staleMs: bad, waitMs: bad })
                assert.deepStrictEqual(c.timeouts, d.timeouts, 'budgetMs 等=' + String(bad) + ' 應取預設')
            }
            let c2 = createCdnLocal({ manifest: fx.manifest, concurrency: 0, maxAttempts: 99, retryDelayMs: -5, pollMs: 'x', offline: 'yes', allowLoopback: 'no', onTrace: 'f' })
            assert.ok(c2.ensure && c2.routeBrowser, '非預期之 opt 不拋錯')
        })

        it('[CL04] 時限對齊: 殘留判定時長 > 單檔上限; 等候上限涵蓋持鎖者最壞結束時刻且 > 殘留判定時長; before 時限涵蓋等候後接手下載且 > 180 秒; 實例之預設值同常數; 小預算時等候上限仍大於殘留判定', function() {
            assert.ok(CDN_LOCK_STALE_MS > CDN_FILE_TOTAL_MS, '殘留判定時長須大於單檔下載上限(慢檔不被誤判為殘留)')
            assert.ok(CDN_WAIT_MS >= CDN_BUDGET_MS + CDN_FILE_TOTAL_MS, '等候上限須涵蓋持鎖者最壞結束時刻(預算 + 單檔上限)')
            assert.ok(CDN_WAIT_MS > CDN_LOCK_STALE_MS, '等候上限須大於殘留判定時長')
            assert.ok(CDN_HOOK_TIMEOUT_MS >= CDN_WAIT_MS + CDN_BUDGET_MS + CDN_FILE_TOTAL_MS, 'before 時限須涵蓋等候後接手為持鎖者之下載')
            assert.ok(CDN_HOOK_TIMEOUT_MS > 180000, 'before 時限不得沿用 mocha 全域之 180 秒')
            assert.deepStrictEqual([CDN_BUDGET_MS, CDN_FILE_TOTAL_MS, CDN_LOCK_STALE_MS, CDN_WAIT_MS, CDN_HOOK_TIMEOUT_MS], [900000, 120000, 150000, 1050000, 2130000], '預設值: 預算 15 分、單檔 120 秒、殘留判定 150 秒、等候 17.5 分(預算＋單檔上限＋30 秒餘裕)、before 35.5 分')
            let c = createCdnLocal({ manifest: fx.manifest })
            assert.deepStrictEqual({ ...c.timeouts }, { budgetMs: CDN_BUDGET_MS, fileTimeoutMs: CDN_FILE_TOTAL_MS, staleMs: CDN_LOCK_STALE_MS, waitMs: CDN_WAIT_MS, hookTimeoutMs: CDN_HOOK_TIMEOUT_MS })
            assert.strictEqual(c.hookTimeoutMs, CDN_HOOK_TIMEOUT_MS)
            assert.ok(Object.isFrozen(c.timeouts))
            let s = createCdnLocal({ manifest: fx.manifest, budgetMs: 10000, fileTimeoutMs: 5000 })
            assert.ok(s.timeouts.staleMs > s.timeouts.fileTimeoutMs && s.timeouts.waitMs > s.timeouts.staleMs, '小預算時衍生之等候上限仍須大於殘留判定: ' + JSON.stringify(s.timeouts))
            assert.ok(s.timeouts.hookTimeoutMs >= s.timeouts.waitMs + s.timeouts.budgetMs + s.timeouts.fileTimeoutMs)
            let s2 = createCdnLocal({ manifest: fx.manifest, budgetMs: 1000, fileTimeoutMs: 1000, staleMs: 600000 })
            assert.ok(s2.timeouts.waitMs > s2.timeouts.staleMs, '明確給大之 staleMs 時, 衍生之等候上限仍大於殘留判定: ' + JSON.stringify(s2.timeouts))
            assert.strictEqual(createCdnLocal({ manifest: fx.manifest, waitMs: 12345 }).timeouts.waitMs, 12345, '明確給定之 waitMs 不被改寫')
        })

    })


    describe('取得流程(R-CL-2)', function() {

        it('[CL05] 首次取得: 每檔恰請求 1 次、內容經校驗、下載紀錄每檔 1 列、鎖已釋放、無暫存檔; 再取得不連網、不取鎖', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('first')
                let evs = []
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10, onTrace: (e) => evs.push(e) })
                assert.strictEqual(cdn.stats().ready, false)
                await cdn.ensure()
                for (let p of sums(fx.bodies)) {
                    assert.strictEqual(srv.hits[p], 1, p + ' 應只被請求 1 次')
                }
                for (let [url, e] of Object.entries(fx.manifest.files)) {
                    let buf = fs.readFileSync(cdn.fileOf(url))
                    assert.strictEqual(sha(buf), e.sha256, url + ' 內容校驗')
                    assert.strictEqual(path.basename(cdn.fileOf(url)), e.sha256, '內容定址: 檔名即 sha256')
                }
                let j = readJournal(cache)
                assert.strictEqual(j.length, 6)
                assert.strictEqual(new Set(j.map((x) => x.url)).size, 6)
                assert.ok(!fs.existsSync(cdn.lockDir), '鎖應已釋放')
                assert.deepStrictEqual(partsOf(cache), [])
                assert.throws(() => cdn.fileOf('https://nope.invalid/x.js'), (err) => err.code === 'E_CDN_EXTERNAL', '不在清單之網址無本地副本路徑')
                assert.strictEqual(cdn.lookup('https://nope.invalid/x.js'), null)
                assert.deepStrictEqual(evs.map((e) => e.type).filter((t) => t !== 'downloaded'), ['lock-acquired', 'ready'])
                assert.ok(evs.every((e) => Object.isFrozen(e)), '事件物件應為凍結(wsemi getTrace 規格)')
                assert.deepStrictEqual(cdn.stats(), { files: 6, contents: 6, ready: true, downloaded: 6, sourced: 0, stubs: 0, served: { browser: 0, fetch: 0 }, violations: 0, offline: false, cacheDir: cache })

                //第二個實例(同快取): 備妥即就緒, 不取鎖、不連網
                let evs2 = []
                let calls = 0
                await createCdnLocal({
                    manifest: fx.manifest,
                    cacheDir: cache,
                    fetch: () => {
                        calls++
                        throw new Error('不應連網')
                    },
                    onTrace: (e) => evs2.push(e.type)
                }).ensure()
                assert.strictEqual(calls, 0)
                assert.deepStrictEqual(evs2, ['ready'])
            }
            finally {
                await srv.close()
            }
        })

        it('[CL06] 殘留鎖(持有者行程已結束)被回收, 取得照常完成', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('stale-dead')
                fs.mkdirSync(path.join(cache, '.lock'), { recursive: true })
                fs.writeFileSync(path.join(cache, '.lock', 'owner.json'), JSON.stringify({ pid: deadPid(), token: 'dead', t: Date.now() }))
                let evs = []
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10, pollMs: 10, onTrace: (e) => evs.push(e.type) }).ensure()
                assert.ok(evs.includes('lock-stale-judged') && evs.includes('lock-stale-reclaimed') && evs.includes('lock-acquired') && evs.includes('ready'), '事件: ' + evs)
                assert.ok(evs.indexOf('lock-stale-reclaimed') < evs.indexOf('lock-acquired'))
                for (let p of sums(fx.bodies)) {
                    assert.strictEqual(srv.hits[p], 1)
                }
                assert.ok(!fs.existsSync(path.join(cache, '.lock')))
            }
            finally {
                await srv.close()
            }
        })

        it('[CL07] 持有者行程仍在但心跳逾殘留判定時長: 被回收', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('stale-beat')
                let lock = path.join(cache, '.lock')
                fs.mkdirSync(lock, { recursive: true })
                let owner = path.join(lock, 'owner.json')
                fs.writeFileSync(owner, JSON.stringify({ pid: process.pid, token: 'old', t: 0 }))
                let old = new Date(Date.now() - 600000)
                fs.utimesSync(owner, old, old)
                let evs = []
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, staleMs: 1000, retryDelayMs: 10, pollMs: 10, onTrace: (e) => evs.push(e.type) }).ensure()
                assert.ok(evs.includes('lock-stale-reclaimed'), '事件: ' + evs)
                for (let p of sums(fx.bodies)) {
                    assert.strictEqual(srv.hits[p], 1)
                }
            }
            finally {
                await srv.close()
            }
        })

        it('[CL08] 持鎖者下載超過殘留判定時長仍持續心跳: 等候者不誤判為殘留(不回收、不重複下載), 持鎖者完成後等候者採用其成果', async function() {
            let gate = deferred()
            let srv = await startServer(fx.bodies, gate)
            try {
                let cache = dirOf('heartbeat')
                let staleMs = 300
                let evA = []
                let evB = []
                let mk = (evs) => createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, staleMs, pollMs: 10, concurrency: 1, retryDelayMs: 10, onTrace: (e) => evs.push(e.type) })
                let A = mk(evA)
                let B = mk(evB)
                let pa = A.ensure()
                await waitUntil(() => evA.includes('lock-acquired') && Object.keys(srv.hits).length >= 1, 20000, 'A 取鎖並已對伺服器發出請求(被 gate 擋住)')
                let t0 = Date.now()
                let pb = B.ensure()

                //事件同步: B 已判斷鎖之狀態達 8 輪, 且 A 持鎖已逾殘留判定時長之 4 倍(此期間 A 之下載被 gate 擋住, 只靠心跳維持不被判殘留)
                await waitUntil(() => evB.filter((e) => e === 'lock-poll').length >= 8 && Date.now() - t0 > staleMs * 4, 20000, 'B 於 A 持鎖逾殘留判定時長後仍在等候')
                assert.ok(!evB.includes('lock-stale-reclaimed'), '持鎖者有心跳, 不應被判殘留而回收: ' + evB.filter((e) => e !== 'lock-poll'))
                gate.resolve()
                await Promise.all([pa, pb])

                //B 可能於 A 釋放鎖後之空檔取到鎖(取到後清單已備妥, 無檔可下載), 此為合法交錯; 不變式為 B 不回收、不下載
                assert.ok(!evB.includes('lock-stale-reclaimed') && !evB.includes('downloaded'), 'B 不應回收鎖或下載: ' + evB.filter((e) => e !== 'lock-poll'))
                for (let p of sums(fx.bodies)) {
                    assert.strictEqual(srv.hits[p], 1, p + ' 應只被請求 1 次')
                }
            }
            finally {
                gate.resolve()
                await srv.close()
            }
        })

        it('[CL09] 持有者行程仍在且心跳新鮮: 等候至上限後 E_CDN_ACQUIRE_TIMEOUT, 不動他人之鎖、不連網', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('timeout')
                let lock = path.join(cache, '.lock')
                fs.mkdirSync(lock, { recursive: true })
                fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'live', t: Date.now() }))
                let evs = []
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, waitMs: 300, staleMs: 3600000, pollMs: 10, onTrace: (e) => evs.push(e.type) })
                await assert.rejects(() => cdn.ensure(), (err) => err.code === 'E_CDN_ACQUIRE_TIMEOUT')
                assert.ok(evs.includes('lock-wait') && !evs.includes('lock-acquired'))
                assert.ok(fs.existsSync(lock), '不得刪除活著之持有者之鎖')
                assert.deepStrictEqual(srv.hits, {}, '等候期間不得對伺服器發出請求')
            }
            finally {
                await srv.close()
            }
        })

        it('[CL10] 兩個回收者交錯(確定性): B 判定殘留後、回收前, 另一行程已回收並取得新鎖 → B 不得刪除該新鎖、不下載, 待其釋放後才取得鎖完成下載', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('reclaim-race')
                let lockDir = path.join(cache, '.lock')
                fs.mkdirSync(lockDir, { recursive: true })
                fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: deadPid(), token: 'dead', t: Date.now() }))
                let other = createDirLock({ lockDir }) //代表另一個行程(同一行程內以原語模擬, 持有者 pid 為本行程, 存活)
                let injected = null
                let evB = []

                //onTrace 於判定後、回收前同步呼叫: 於其中先讓「另一行程」完成回收並取得新鎖, 精確重現交錯
                let B = createCdnLocal({
                    manifest: fx.manifest,
                    cacheDir: cache,
                    fetch: srv.fetch,
                    pollMs: 10,
                    concurrency: 1,
                    retryDelayMs: 10,
                    onTrace: (e) => {
                        evB.push(e.type)
                        if (e.type === 'lock-stale-judged' && !injected) {
                            let judged = other.judge()
                            injected = { judged, reclaimed: other.reclaim(judged), locked: other.tryLock() }
                        }
                    }
                })
                let pb = B.ensure()
                await waitUntil(() => injected && evB.filter((e) => e === 'lock-poll').length >= 5, 20000, '另一行程取得新鎖後 B 回到等候')
                assert.deepStrictEqual([injected.judged, injected.reclaimed, injected.locked], [{ token: 'dead' }, true, true], '前置: 另一行程已回收並取得新鎖')
                let tokOther = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).token
                assert.ok(tokOther && tokOther !== 'dead')
                assert.ok(!evB.includes('lock-stale-reclaimed'), 'B 不應回收另一行程之新鎖: ' + evB.filter((e) => e !== 'lock-poll'))
                assert.ok(!evB.includes('lock-acquired'), 'B 不應取得鎖(鎖在另一行程手上)')
                assert.deepStrictEqual(srv.hits, {}, 'B 不得下載')
                assert.strictEqual(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).token, tokOther, '另一行程之新鎖應仍在(被誤搬者須已改回)')
                assert.deepStrictEqual(fs.readdirSync(cache).filter((f) => /\.stale-/.test(f)), [], '不應遺留被搬走之鎖資料夾')
                other.release()
                await pb
                assert.ok(evB.includes('lock-acquired') && evB.includes('ready'))
                for (let p of sums(fx.bodies)) {
                    assert.strictEqual(srv.hits[p], 1, p + ' 應只被請求 1 次')
                }
            }
            finally {
                await srv.close()
            }
        })

        it('[CL36] 取得鎖後先重算缺檔清單: 殘留鎖被回收後、取鎖前, 他行程已把檔補齊 → 取得鎖者不下載(同一把鎖內檢查與寫入)', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('recheck')
                fs.mkdirSync(path.join(cache, '.lock'), { recursive: true })
                fs.writeFileSync(path.join(cache, '.lock', 'owner.json'), JSON.stringify({
                    pid: deadPid(),
                    token: 'dead',
                }))
                let evs = []
                let cdn = createCdnLocal({
                    manifest: fx.manifest,
                    cacheDir: cache,
                    fetch: srv.fetch,
                    pollMs: 10,
                    retryDelayMs: 10,
                    onTrace: (e) => {
                        evs.push(e.type)

                        //回收後、取鎖前(同步): 代表「他行程於此空檔把全部檔補齊」
                        if (e.type === 'lock-stale-reclaimed') {
                            for (let [p, b] of Object.entries(fx.bodies)) {
                                fs.writeFileSync(path.join(cache, fx.manifest.files[HOST + p].sha256), b)
                            }
                        }
                    },
                })
                await cdn.ensure()
                assert.ok(evs.includes('lock-stale-reclaimed') && evs.includes('lock-acquired') && evs.includes('ready'), '事件: ' + evs)
                assert.ok(!evs.includes('downloaded'), '取得鎖後檔已齊, 不得再下載: ' + evs)
                assert.deepStrictEqual(srv.hits, {}, '不得連網')
                assert.ok(!fs.existsSync(cdn.lockDir))
            }
            finally {
                await srv.close()
            }
        })

        it('[CL37] 下載後回驗: 回驗時仍有缺檔(例如下載完成後被刪除)即拋 E_CDN_VERIFY 並釋放鎖', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('verify')
                let n = 0
                let cdn = createCdnLocal({
                    manifest: fx.manifest,
                    cacheDir: cache,
                    fetch: srv.fetch,
                    concurrency: 1,
                    retryDelayMs: 10,
                    onTrace: (e) => {
                        if (e.type === 'downloaded' && ++n === 1) {
                            fs.rmSync(cdn.fileOf(e.url)) //第一檔下載完成之當下被刪除(同步)
                        }
                    },
                })
                let err = await cdn.ensure().catch((x) => x)
                assert.strictEqual(err.code, 'E_CDN_VERIFY', String(err && err.message))
                assert.ok(/缺 1 檔/.test(err.message), err.message)
                assert.ok(!fs.existsSync(cdn.lockDir), '鎖應釋放')
            }
            finally {
                await srv.close()
            }
        })

        it('[CL11] 同內容(sha256 相同)之多個網址只下載一次, 兩個網址皆就緒', async function() {
            let bodies = { ...fx.bodies }
            let paths = Object.keys(bodies)
            bodies['/dup/same.js'] = bodies[paths[0]] //與第一檔同內容之另一網址
            let manifest = { schema: 1, roots: {}, files: { ...fx.manifest.files, [HOST + '/dup/same.js']: { ...fx.manifest.files[HOST + paths[0]] } } }
            let srv = await startServer(bodies)
            try {
                let cache = dirOf('dedupe')
                let evs = []
                let cdn = createCdnLocal({ manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10, onTrace: (e) => evs.push(e) })
                await cdn.ensure()
                assert.strictEqual(evs.filter((e) => e.type === 'downloaded').length, 6, '7 個網址、6 種內容 → 只下載 6 次')
                assert.strictEqual((srv.hits[paths[0]] || 0) + (srv.hits['/dup/same.js'] || 0), 1, '同內容之兩網址合計只請求 1 次')
                assert.strictEqual(cdn.fileOf(HOST + '/dup/same.js'), cdn.fileOf(HOST + paths[0]), '兩網址指向同一內容定址檔')
                assert.deepStrictEqual([cdn.stats().files, cdn.stats().contents], [7, 6])
                let cdn2 = createCdnLocal({ manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10 })
                await cdn2.ensure()
                assert.strictEqual((srv.hits[paths[0]] || 0) + (srv.hits['/dup/same.js'] || 0), 1)
            }
            finally {
                await srv.close()
            }
        })

        it('[CL12] 持鎖者之下載逾預算: 不再派發新檔, 以 E_CDN_ACQUIRE_TIMEOUT 失敗並釋放鎖; 失敗被記住(再取得得同一錯誤、不重跑)', async function() {
            let slow = makeFixture(6)
            let srv = await startServer(slow.bodies, null, 120) //每個請求延遲 120 毫秒, 6 檔序列下載至少 720 毫秒
            try {
                let cache = dirOf('budget')
                let evs = []
                let cdn = createCdnLocal({ manifest: slow.manifest, cacheDir: cache, fetch: srv.fetch, budgetMs: 200, concurrency: 1, retryDelayMs: 10, onTrace: (e) => evs.push(e.type) })
                await assert.rejects(() => cdn.ensure(), (err) => err.code === 'E_CDN_ACQUIRE_TIMEOUT' && /預算/.test(err.message))
                let nd = evs.filter((e) => e === 'downloaded').length
                assert.ok(nd >= 1 && nd < 6, '應已下載部分檔而未全部完成: ' + nd)
                assert.ok(!fs.existsSync(cdn.lockDir), '失敗後鎖應釋放')
                let hits = JSON.stringify(srv.hits)
                let e1 = await cdn.ensure().catch((e) => e)
                let e2 = await cdn.ensure().catch((e) => e)
                assert.strictEqual(e1, e2, '失敗被記住, 回傳同一個錯誤')
                assert.strictEqual(JSON.stringify(srv.hits), hits, '失敗後再 ensure 不得再連網')
                assert.strictEqual(cdn.stats().ready, false)
            }
            finally {
                await srv.close()
            }
        })

        it('[CL13] 下載內容與清單之 sha256 不符即拒收(E_HASH_MISMATCH): 不留未驗證之檔、鎖已釋放、無暫存檔', async function() {
            let bad = { ...fx.bodies }
            let victim = Object.keys(bad)[2]
            bad[victim] = Buffer.from(String(bad[victim]).replace(/c/g, 'z')) //同長度、內容不同
            assert.strictEqual(bad[victim].length, fx.bodies[victim].length)
            let srv = await startServer(bad)
            try {
                let cache = dirOf('mismatch')
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, maxAttempts: 1, retryDelayMs: 10, pollMs: 10 })
                await assert.rejects(() => cdn.ensure(), (err) => err.code === 'E_HASH_MISMATCH' && /f2\.js/.test(err.message))
                let e = fx.manifest.files[HOST + victim]
                assert.ok(!fs.existsSync(path.join(cache, e.sha256)), '不符之內容不得落在最終位置')
                assert.ok(!fs.existsSync(cdn.lockDir), '失敗後鎖應釋放')
                assert.deepStrictEqual(partsOf(cache), [], '不應殘留暫存檔')
            }
            finally {
                await srv.close()
            }
        })

        it('[CL14] 下載失敗帶 fsDownloadFileVerify 之 code(404 為 E_HTTP, 不重試); 訊息之網址經 maskDiagText 遮蔽查詢秘密值', async function() {
            let url = 'https://cdn.fixture.invalid/q/a.js?token=SECRETVALUE123'
            let body = Buffer.from('x=1')
            let manifest = { schema: 1, files: { [url]: { sha256: sha(body), size: body.length } } }
            let srv = await startServer({})
            try {
                let cdn = createCdnLocal({ manifest, cacheDir: dirOf('http404'), fetch: srv.fetch, maxAttempts: 3, retryDelayMs: 10 })
                let err = await cdn.ensure().catch((e) => e)
                assert.strictEqual(err.code, 'E_HTTP')
                assert.ok(!/SECRETVALUE123/.test(err.message + String(err.cdnUrl)), '查詢秘密值須遮蔽: ' + err.message)
                assert.ok(/a\.js/.test(err.message))
                assert.strictEqual(Object.values(srv.hits)[0], 1, '404 不重試')
            }
            finally {
                await srv.close()
            }
        })

        it('[CL15] 快取內之檔遭損毀(同長度、內容不同)即被偵測並只重取該檔; 備妥後不取鎖、不連網', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('corrupt')
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10 }).ensure()
                let urls = Object.keys(fx.manifest.files)
                let victim = urls[3]
                let fp = path.join(cache, fx.manifest.files[victim].sha256)
                let buf = fs.readFileSync(fp)
                buf[10] = buf[10] ^ 0xff
                fs.writeFileSync(fp, buf)
                let evs = []
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10, onTrace: (e) => evs.push(e) }).ensure()
                assert.deepStrictEqual(evs.filter((e) => e.type === 'downloaded').map((e) => e.url), [victim], '只應重取損毀之 1 檔')
                assert.strictEqual(sha(fs.readFileSync(fp)), fx.manifest.files[victim].sha256)
                assert.strictEqual(srv.hits[Object.keys(fx.bodies)[3]], 2, '損毀之檔共請求 2 次, 其餘 1 次')
            }
            finally {
                await srv.close()
            }
        })

        it('[CL16] 缺檔而大小不符之檔(截斷)亦被偵測並重取', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('truncated')
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10 }).ensure()
                let victim = Object.keys(fx.manifest.files)[1]
                let fp = path.join(cache, fx.manifest.files[victim].sha256)
                fs.writeFileSync(fp, fs.readFileSync(fp).subarray(0, 10))
                let evs = []
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10, onTrace: (e) => evs.push(e) }).ensure()
                assert.deepStrictEqual(evs.filter((e) => e.type === 'downloaded').map((e) => e.url), [victim])
            }
            finally {
                await srv.close()
            }
        })

        it('[CL17] 持鎖後清除已逾殘留判定時長之殘留暫存檔(.part)與墓碑資料夾, 較新者不動', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('sweep')
                fs.mkdirSync(cache, { recursive: true })
                let age = (fp, msAgo) => {
                    let d = new Date(Date.now() - msAgo)
                    fs.utimesSync(fp, d, d)
                }
                let oldPart = path.join(cache, 'aaaa.123.abc.part')
                let newPart = path.join(cache, 'bbbb.456.def.part')
                let oldTomb = path.join(cache, '.lock.stale-99-aa')
                let other = path.join(cache, 'keep.txt')
                fs.writeFileSync(oldPart, 'x')
                fs.writeFileSync(newPart, 'y')
                fs.writeFileSync(other, 'z')
                fs.mkdirSync(oldTomb)
                fs.writeFileSync(path.join(oldTomb, 'owner.json'), '{}')
                age(oldPart, 10000)
                age(other, 10000)
                age(oldTomb, 10000)
                let evs = []
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, staleMs: 1000, retryDelayMs: 10, onTrace: (e) => evs.push(e) }).ensure()
                assert.ok(!fs.existsSync(oldPart) && !fs.existsSync(oldTomb), '逾時之殘留暫存檔與墓碑應被清除')
                assert.ok(fs.existsSync(newPart), '較新之暫存檔(可能正被下載)不得刪')
                assert.ok(fs.existsSync(other), '非暫存檔不得刪')
                assert.deepStrictEqual(evs.filter((e) => e.type === 'swept').map((e) => e.n), [2])
            }
            finally {
                await srv.close()
            }
        })

        it('[CL18] 同一實例並行呼叫 ensure() 共用一次取得(只取一次鎖、同一個 Promise)', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let evs = []
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('shared'), fetch: srv.fetch, retryDelayMs: 10, onTrace: (e) => evs.push(e.type) })
                let ps = [cdn.ensure(), cdn.ensure(), cdn.ensure()]
                assert.strictEqual(ps[0], ps[1])
                await Promise.all(ps)
                assert.strictEqual(evs.filter((e) => e === 'lock-acquired').length, 1)
                assert.strictEqual(evs.filter((e) => e === 'ready').length, 1)
            }
            finally {
                await srv.close()
            }
        })

        it('[CL19] 離線: 缺檔時 E_CDN_OFFLINE_MISSING(帶 missing[]、訊息只含檔名不含 sha256 與路徑)且不連網; 備妥時照常就緒; 環境變數 W_CDN_OFFLINE 生效, opt.offline 優先', async function() {
            let srv = await startServer(fx.bodies)
            let saved = process.env.W_CDN_OFFLINE
            try {
                let cache = dirOf('offline')
                let err = await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, offline: true }).ensure().catch((e) => e)
                assert.strictEqual(err.code, 'E_CDN_OFFLINE_MISSING')
                assert.deepStrictEqual(srv.hits, {})
                assert.strictEqual(err.missing.length, 6)
                let m0 = err.missing[0]
                assert.deepStrictEqual(Object.keys(m0).sort(), ['cachePath', 'sha256', 'size', 'url'])
                assert.strictEqual(m0.cachePath, path.join(cache, m0.sha256))
                assert.ok(/f0\.js/.test(err.message), '訊息含檔名: ' + err.message)
                assert.ok(!err.message.includes(m0.sha256) && !err.message.includes(cache), '訊息不得含 sha256 與路徑')
                assert.ok(!fs.existsSync(path.join(cache, '.lock')), '離線不取鎖')

                //環境變數
                process.env.W_CDN_OFFLINE = '1'
                let e2 = await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch }).ensure().catch((e) => e)
                assert.strictEqual(e2.code, 'E_CDN_OFFLINE_MISSING', '環境變數 W_CDN_OFFLINE=1 應視為離線')
                assert.strictEqual(createCdnLocal({ manifest: fx.manifest, cacheDir: cache, offline: false }).stats().offline, false, 'opt.offline 優先於環境變數')
                for (let v of ['true', 'TRUE']) {
                    process.env.W_CDN_OFFLINE = v
                    assert.strictEqual(createCdnLocal({ manifest: fx.manifest, cacheDir: cache }).stats().offline, true, v)
                }
                for (let v of ['0', 'no', '']) {
                    process.env.W_CDN_OFFLINE = v
                    assert.strictEqual(createCdnLocal({ manifest: fx.manifest, cacheDir: cache }).stats().offline, false, v)
                }
                delete process.env.W_CDN_OFFLINE

                //備妥後離線照常就緒
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10 }).ensure()
                await createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, offline: true }).ensure()
                for (let p of sums(fx.bodies)) {
                    assert.strictEqual(srv.hits[p], 1)
                }
            }
            finally {
                if (saved === undefined) {
                    delete process.env.W_CDN_OFFLINE
                }
                else {
                    process.env.W_CDN_OFFLINE = saved
                }
                await srv.close()
            }
        })

        it('[CL20] 下載用 fetch 之取得: 剝除本模組之全域補丁(補丁安裝後建立之實例仍可下載), 不剝除他人之補丁', async function() {
            let srv = await startServer(fx.bodies)
            let a = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('nf-a') })
            let restore = a.patchFetch()
            try {
                let native = cdnNativeFetch()
                assert.ok(typeof native === 'function' && native !== globalThis.fetch, '全域 fetch 已被補丁, 原生 fetch 應是補丁之下一層')
                assert.strictEqual(native, realFetch)

                //補丁之下建立實例: 未給 opt.fetch 時走原生 fetch(以夾具伺服器之網址當清單網址, 回送位址之下載不被補丁攔截)
                let body = Buffer.from('window.__ok=1')
                let srv2 = await startServer({ '/own.js': body })
                try {
                    let m = { schema: 1, files: { [srv2.baseUrl + '/own.js']: { sha256: sha(body), size: body.length } } }
                    await createCdnLocal({ manifest: m, cacheDir: dirOf('nf-b'), retryDelayMs: 10 }).ensure()
                    assert.strictEqual(srv2.hits['/own.js'], 1)
                }
                finally {
                    await srv2.close()
                }

                //他人之補丁不剝除
                let other = async () => new Response('other')
                let prev = globalThis.fetch
                globalThis.fetch = other
                try {
                    assert.strictEqual(cdnNativeFetch(), other)
                }
                finally {
                    globalThis.fetch = prev
                }
            }
            finally {
                restore()
                await srv.close()
            }
            assert.strictEqual(globalThis.fetch, realFetch, '還原後應回到原生 fetch')
        })

    })


    describe('違規之判定(R-CL-5)', function() {

        it('[CL21] violationMark／assertNoViolation: 自標記起無違規不拋; 有違規(含呼叫端吞掉錯誤者)拋 E_CDN_EXTERNAL; 標記之前之違規不影響; 他實例之標記或亂給即拋 E_CDN_ARG; 違規紀錄凍結且遮蔽查詢秘密值', async function() {
            let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('marks') })
            let restore = cdn.patchFetch()
            try {
                let ok = cdn.violationMark()
                assert.doesNotThrow(() => cdn.assertNoViolation(ok))
                assert.doesNotThrow(() => cdn.assertNoViolation(), '不給標記: 自實例建立起, 目前無違規')
                let mark = cdn.violationMark()
                await fetch('https://example.invalid/swallowed.css?token=SECRET42').catch(() => {}) //呼叫端吞掉錯誤
                assert.throws(() => cdn.assertNoViolation(mark), (err) => err.code === 'E_CDN_EXTERNAL' && err.violations.length === 1 && err.violations[0].url.startsWith('https://example.invalid/swallowed.css') && !/SECRET42/.test(err.message + JSON.stringify(err.violations)))
                assert.throws(() => cdn.assertNoViolation(ok), (err) => err.code === 'E_CDN_EXTERNAL', '較早之標記涵蓋之後之違規')
                assert.throws(() => cdn.assertNoViolation(), (err) => err.code === 'E_CDN_EXTERNAL')
                assert.doesNotThrow(() => cdn.assertNoViolation(cdn.violationMark()), '標記之後無新增違規者不受先前違規影響')
                let vs = cdn.getViolations()
                assert.strictEqual(vs.length, 1)
                assert.ok(Object.isFrozen(vs[0]) && vs[0].kind === 'fetch')
                vs.pop()
                assert.strictEqual(cdn.getViolations().length, 1, 'getViolations 回傳複本')
                assert.strictEqual(cdn.stats().violations, 1)
                let other = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('marks2') })
                for (let bad of [other.violationMark(), 3, 'x', {}, { id: 1, n: -1 }, { id: 1, n: 1.5 }, [], true]) {
                    assert.throws(() => cdn.assertNoViolation(bad), (err) => err.code === 'E_CDN_ARG', JSON.stringify(bad))
                }
            }
            finally {
                restore()
            }
        })

    })


    describe('Node 端 fetch 補丁(R-CL-6)', function() {
        let srv = null

        it('[CL35] 清單內之網址而本地副本不可用(離線缺檔)時拋 E_CDN_UNAVAILABLE 並記為違規(不放行外網、不連網)', async function() {
            let cacheDir = dirOf('unavail')
            let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir, offline: true })
            let r = cdn.patchFetch()
            try {
                let mark = cdn.violationMark()
                let u = HOST + '/pkg-0@1.0.0/dist/f0.js'
                let err = await fetch(u).catch((e) => e)
                assert.strictEqual(err.code, 'E_CDN_UNAVAILABLE')
                assert.strictEqual(err.cause.code, 'E_CDN_OFFLINE_MISSING')
                assert.ok(!err.message.includes(cacheDir), '訊息不得含本機路徑: ' + err.message)
                assert.throws(() => cdn.assertNoViolation(mark), (e) => e.code === 'E_CDN_EXTERNAL' && e.violations[0].kind === 'fetch' && /不可用/.test(e.violations[0].reason))
            }
            finally {
                r()
            }
        })

        let cdn = null
        let restore = null
        let cache = null

        before(async function() {
            srv = await startServer({ ...fx.bodies, '/local.txt': Buffer.from('loopback-ok') })
            cache = dirOf('patch')
        })

        beforeEach(async function() {
            cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, fetch: srv.fetch, retryDelayMs: 10, pollMs: 10 })
            await cdn.ensure()
            restore = cdn.patchFetch()
        })

        afterEach(function() {
            restore()
        })

        after(async function() {
            await srv.close()
        })

        it('[CL22] 清單內之網址回本地副本(位元組與 content-type 正確, 不連網); 字串、URL、Request 三種輸入形式與片段亦同', async function() {
            let before = JSON.stringify(srv.hits)
            let u0 = HOST + '/pkg-0@1.0.0/dist/f0.js'
            let res = await fetch(u0)
            assert.strictEqual(res.status, 200)
            assert.ok(/javascript/.test(res.headers.get('content-type')))
            assert.strictEqual(sha(Buffer.from(await res.arrayBuffer())), fx.manifest.files[u0].sha256)
            let res2 = await fetch(new URL(HOST + '/pkg-1@1.0.1/dist/f1.js'))
            assert.strictEqual(sha(Buffer.from(await res2.arrayBuffer())), fx.manifest.files[HOST + '/pkg-1@1.0.1/dist/f1.js'].sha256)
            let res3 = await fetch(new Request(HOST + '/pkg-2@1.0.2/dist/f2.js'))
            assert.strictEqual(sha(Buffer.from(await res3.arrayBuffer())), fx.manifest.files[HOST + '/pkg-2@1.0.2/dist/f2.js'].sha256)
            let res4 = await fetch(u0 + '#frag')
            assert.strictEqual(res4.status, 200, '片段不屬網址之一部分')
            assert.strictEqual(JSON.stringify(srv.hits), before, '清單內之網址不得連網')
            assert.strictEqual(cdn.stats().served.fetch, 4)
        })

        it('[CL23] 清單以外之 http(s) 網址拋 E_CDN_EXTERNAL 並記錄(含同路徑而查詢字串不同者); 非 http(s)(data:)原樣通過', async function() {
            let n0 = cdn.getViolations().length
            await assert.rejects(() => fetch('https://example.invalid/not-in-table.css'), (err) => err.code === 'E_CDN_EXTERNAL')
            await assert.rejects(() => fetch(HOST + '/pkg-0@1.0.0/dist/f0.js?v=2'), (err) => err.code === 'E_CDN_EXTERNAL', '查詢字串不同即不同網址')
            await assert.rejects(() => fetch('http://192.0.2.1/x'), (err) => err.code === 'E_CDN_EXTERNAL', '非回送位址之內網位址亦屬外部')
            await assert.rejects(() => fetch('http://localhost.invalid/x'), (err) => err.code === 'E_CDN_EXTERNAL', 'localhost.invalid 不是回送位址')
            await assert.rejects(() => fetch('http://127.0.0.1.invalid/x'), (err) => err.code === 'E_CDN_EXTERNAL', '前綴像回送位址之外部主機')
            let vs = cdn.getViolations().slice(n0)
            assert.deepStrictEqual(vs.map((v) => v.kind), ['fetch', 'fetch', 'fetch', 'fetch', 'fetch'])
            let res = await fetch('data:text/plain,hello')
            assert.strictEqual(await res.text(), 'hello')
            assert.strictEqual(cdn.getViolations().length, n0 + 5, 'data: 不計違規')
        })

        it('[CL23b] 請求網址先依 fetch 自己之解析規則正規化再判定: 前後空白、tab、換行、主機大小寫、預設埠不得使外部請求繞過; 清單內之網址亦以正規化形式比對', async function() {
            let n0 = cdn.getViolations().length
            let ext = [
                ' https://example.invalid/a',
                '\thttps://example.invalid/b',
                'https://example.invalid/c\n',
                'ht\ttps://example.invalid/d',
                'HTTPS://EXAMPLE.INVALID:443/e',
                { toString: () => 'https://example.invalid/f' },
                new Request('https://example.invalid/g'),
                new URL('https://example.invalid/h'),
            ]
            for (let x of ext) {
                await assert.rejects(() => fetch(x), (err) => err.code === 'E_CDN_EXTERNAL', String(x && x.url ? x.url : x))
            }
            assert.deepStrictEqual(cdn.getViolations().slice(n0).map((v) => v.url), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => `https://example.invalid/${c}`))
            let n1 = cdn.getViolations().length
            let u0 = HOST + '/pkg-0@1.0.0/dist/f0.js'
            for (let x of [' ' + u0, 'HTTPS://CDN.FIXTURE.INVALID:443/pkg-0@1.0.0/dist/f0.js', u0 + '\n', 'ht\ttps://cdn.fixture.invalid/pkg-0@1.0.0/dist/f0.js']) {
                let r = await fetch(x)
                assert.strictEqual(sha(Buffer.from(await r.arrayBuffer())), fx.manifest.files[u0].sha256, JSON.stringify(x))
            }
            assert.strictEqual(cdn.getViolations().length, n1, '清單內之各種寫法不計違規')

            //相對網址與無法解析者交給原 fetch(由其拋原生錯誤, 不是 E_CDN_EXTERNAL)
            for (let x of ['/relative', 'not a url', '']) {
                await fetch(x).then(() => assert.fail('應拋錯'), (err) => assert.notStrictEqual(err.code, 'E_CDN_EXTERNAL', JSON.stringify(x)))
            }
            assert.strictEqual(cdn.getViolations().length, n1)
        })

        it('[CL24] 回送位址(localhost、127.x.x.x、[::1])原樣放行(走原 fetch); allowLoopback:false 則視為外部; allow(RegExp、函數)明列者放行, 函數拋錯視為不放行', async function() {
            let res = await fetch(srv.baseUrl + '/local.txt')
            assert.strictEqual(await res.text(), 'loopback-ok')
            let port = new URL(srv.baseUrl).port
            let res2 = await fetch(`http://localhost:${port}/local.txt`).catch((e) => e) //localhost 可能解析為 ::1 而伺服器只聽 127.0.0.1: 只要求不被判為違規
            assert.ok(!(res2 && res2.code === 'E_CDN_EXTERNAL'), 'localhost 不得被判外部')
            restore()
            let strict = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, allowLoopback: false })
            let rs = strict.patchFetch()
            try {
                await assert.rejects(() => fetch(srv.baseUrl + '/local.txt'), (err) => err.code === 'E_CDN_EXTERNAL', 'allowLoopback:false')
            }
            finally {
                rs()
            }
            let withAllow = createCdnLocal({
                manifest: fx.manifest,
                cacheDir: cache,
                allowLoopback: false,
                allow: [new RegExp('^' + srv.baseUrl.replace(/[.:/]/g, '\\$&') + '/local\\.txt$'), () => {
                    throw new Error('allow 函數拋錯')
                }]
            })
            let ra = withAllow.patchFetch()
            try {
                assert.strictEqual(await (await fetch(srv.baseUrl + '/local.txt')).text(), 'loopback-ok', 'allow RegExp')
                await assert.rejects(() => fetch(srv.baseUrl + '/pkg-0@1.0.0/dist/f0.js'), (err) => err.code === 'E_CDN_EXTERNAL', 'allow 未涵蓋之路徑、函數拋錯者不放行')
            }
            finally {
                ra()
            }
            let notTrue = createCdnLocal({
                manifest: fx.manifest,
                cacheDir: cache,
                allowLoopback: false,
                allow: [async () => true, async () => {
                    throw new Error('async reject')
                }, () => 'yes', () => 1, () => ({})],
            })
            let rn = notTrue.patchFetch()
            let unhandled = []
            let onUnhandled = (e) => unhandled.push(e)
            process.on('unhandledRejection', onUnhandled)
            try {
                await assert.rejects(() => fetch(srv.baseUrl + '/local.txt'), (err) => err.code === 'E_CDN_EXTERNAL', 'allow 函數須恰回傳 true: async 函數(Promise)、真值非 true 者皆不放行')

                //async 函數不被等待, 其 rejection 須已攔下(未處理之拒絕於事件迴圈之下一輪才通報)
                await new Promise((resolve) => setImmediate(resolve))
                await new Promise((resolve) => setImmediate(resolve))
                assert.deepStrictEqual(unhandled, [], 'allow 之 async 函數之 rejection 不得成為未處理之拒絕')
            }
            finally {
                process.off('unhandledRejection', onUnhandled)
                rn()
            }
            let withG = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, allowLoopback: false, allow: [new RegExp('^' + srv.baseUrl.replace(/[.:/]/g, '\\$&') + '/local\\.txt$', 'g')] })
            let rg = withG.patchFetch()
            try {
                for (let i = 0; i < 3; i++) {
                    assert.strictEqual(await (await fetch(srv.baseUrl + '/local.txt')).text(), 'loopback-ok', `帶 g 旗標之 allow RegExp 第 ${i + 1} 次比對(每次重設 lastIndex)`)
                }
            }
            finally {
                rg()
            }
            let withFn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, allowLoopback: false, allow: [(u) => u.endsWith('/local.txt')] })
            let rf = withFn.patchFetch()
            try {
                assert.strictEqual(await (await fetch(srv.baseUrl + '/local.txt')).text(), 'loopback-ok', 'allow 函數')
            }
            finally {
                rf()
            }
            restore = cdn.patchFetch() //供 afterEach 還原
        })

        it('[CL25] 清單內優先於放行: 清單列了回送位址之網址時, 由本地副本回應(不連該伺服器)', async function() {
            restore()
            let u = srv.baseUrl + '/listed.js'
            let body = Buffer.from('listed')
            let c = createCdnLocal({ manifest: { schema: 1, files: { [u]: { sha256: sha(body), size: body.length } } }, cacheDir: dirOf('listed'), fetch: async () => new Response(body), retryDelayMs: 10 })
            await c.ensure()
            let r = c.patchFetch()
            try {
                let before = JSON.stringify(srv.hits)
                assert.strictEqual(await (await fetch(u)).text(), 'listed')
                assert.strictEqual(JSON.stringify(srv.hits), before, '不得連該伺服器')
            }
            finally {
                r()
            }
            restore = cdn.patchFetch()
        })

        it('[CL26] patchFetch: 同一實例重複呼叫回傳同一個還原函數; 還原後全域 fetch 回到原值, 還原可重複呼叫; 還原後再補丁可行; 非 LIFO 還原(被他人包在其上)不破壞鏈', async function() {
            assert.strictEqual(cdn.patchFetch(), restore, '同一實例重複補丁回傳同一個還原函數')
            let patchedFetch = globalThis.fetch
            restore()
            assert.notStrictEqual(globalThis.fetch, patchedFetch)
            assert.strictEqual(globalThis.fetch, realFetch, '還原後回到原生 fetch')
            restore()
            await assert.doesNotReject(() => fetch(srv.baseUrl + '/local.txt'))
            await fetch(DEAD_URL).then(() => assert.fail('應為網路錯誤'), (err) => assert.notStrictEqual(err.code, 'E_CDN_EXTERNAL', '還原後不再攔截'))

            //非 LIFO: A 補丁, B 補丁(包在 A 上), A 先還原 → A 改為直通, B 仍攔截且可還原至 A 之直通層
            let A = createCdnLocal({ manifest: fx.manifest, cacheDir: cache })
            let B = createCdnLocal({ manifest: fx.manifest, cacheDir: cache })
            let ra = A.patchFetch()
            let rb = B.patchFetch()
            ra()
            await assert.rejects(() => fetch('https://example.invalid/y'), (err) => err.code === 'E_CDN_EXTERNAL', 'B 仍攔截')
            assert.strictEqual(A.getViolations().length, 0, 'A 已還原, 其下之請求不經 A 判定')
            assert.strictEqual(B.getViolations().length, 1)
            rb()
            assert.strictEqual(typeof globalThis.fetch, 'function')
            await fetch(DEAD_URL).then(() => assert.fail('應為網路錯誤'), (err) => assert.notStrictEqual(err.code, 'E_CDN_EXTERNAL'))
            assert.strictEqual(B.getViolations().length, 1)

            //還原到原生 fetch 為止: 全域 fetch 不得殘留包裝
            globalThis.fetch = realFetch
            restore = cdn.patchFetch()
        })

    })


    describe('路由處理器之各分支(替身, R-CL-4)', function() {

        //替身(mkCtx、mkBrowser、mkReq、mkRoute 於 test/tools/cdnLocalFixture.mjs): 只實作 routeBrowser 會用到之 Playwright 介面, 讓每個分支(清單內、清單外、放行、非網路、本地副本不可用)確定性地走到
        let cdnOf = async (extra = {}) => {
            let srv = await startServer(fx.bodies)
            let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('route'), fetch: srv.fetch, retryDelayMs: 10, ...extra })
            await cdn.ensure()
            await srv.close()
            return cdn
        }

        it('[CL28] 清單內之網址由本地副本回應(200、content-type、CORS、位元組); 片段與查詢之處理同 lookup', async function() {
            let cdn = await cdnOf()
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            assert.strictEqual(ctx.routes.length, 1)
            assert.strictEqual(ctx.routes[0][0], '**/*', '路由涵蓋全部網址')
            let u = HOST + '/pkg-4@1.0.4/dist/f4.js'
            let r = mkRoute(u)
            await ctx.routes[0][1](r)
            assert.strictEqual(r.calls.length, 1)
            let [kind, o] = r.calls[0]
            assert.strictEqual(kind, 'fulfill')
            assert.strictEqual(o.status, 200)
            assert.strictEqual(o.headers['content-type'], 'application/javascript; charset=utf-8')
            assert.strictEqual(o.headers['access-control-allow-origin'], '*')
            assert.strictEqual(sha(o.body), fx.manifest.files[u].sha256)
            assert.strictEqual(cdn.stats().served.browser, 1)
            assert.strictEqual(cdn.getViolations().length, 0)
        })

        it('[CL38] 清單內優先於放行(瀏覽器端): 清單列了回送位址之網址時由本地副本回應, 同一主機之其他路徑仍放行', async function() {
            let srv = await startServer({})
            let u = srv.baseUrl + '/listed.js'
            let body = Buffer.from('listed')
            try {
                let cdn = createCdnLocal({
                    manifest: { schema: 1, files: { [u]: { sha256: sha(body), size: body.length } } },
                    cacheDir: dirOf('route-listed'),
                    fetch: async () => new Response(body),
                    retryDelayMs: 10,
                })
                await cdn.ensure()
                let ctx = mkCtx()
                await cdn.routeBrowser(ctx)
                let r = mkRoute(u)
                await ctx.routes[0][1](r)
                assert.deepStrictEqual(r.calls.map((c) => c[0]), ['fulfill'])
                assert.strictEqual(r.calls[0][1].body.toString(), 'listed')
                let r2 = mkRoute(srv.baseUrl + '/other.js')
                await ctx.routes[0][1](r2)
                assert.deepStrictEqual(r2.calls.map((c) => c[0]), ['fallback'])
            }
            finally {
                await srv.close()
            }
        })

        it('[CL29] 清單外之 http(s) 請求中止(blockedbyclient)並記錄; 回送位址與 allow 明列者放行(fallback); 非網路請求(data:、blob:、file:、about:)不處理', async function() {
            let cdn = await cdnOf({ allow: [/^https:\/\/api\.example\.test\//] })
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let h = ctx.routes[0][1]
            let run = async (u) => {
                let r = mkRoute(u)
                await h(r)
                return r.calls.map((c) => c[0] + (c[1] && typeof c[1] === 'string' ? ':' + c[1] : ''))
            }
            assert.deepStrictEqual(await run('https://example.invalid/a.js'), ['abort:blockedbyclient'])
            assert.deepStrictEqual(await run('https://cdn.fixture.invalid/pkg-0@1.0.0/dist/f0.js?v=2'), ['abort:blockedbyclient'], '查詢不同即清單外')
            assert.deepStrictEqual(await run('http://127.0.0.1:8080/app'), ['fallback'])
            assert.deepStrictEqual(await run('http://localhost:3000/'), ['fallback'])
            assert.deepStrictEqual(await run('http://[::1]:3000/'), ['fallback'])
            assert.deepStrictEqual(await run('http://foo.localhost:3000/'), ['fallback'])
            assert.deepStrictEqual(await run('https://api.example.test/x'), ['fallback'], 'allow')
            assert.deepStrictEqual(await run('https://api.example.test.evil.invalid/x'), ['abort:blockedbyclient'], 'allow 之 RegExp 錨定不得被前綴欺騙')
            assert.deepStrictEqual(await run('http://127.0.0.1.evil.invalid/'), ['abort:blockedbyclient'])
            for (let u of ['data:text/plain,x', 'blob:http://x/1', 'file:///c:/a.html', 'about:blank']) {
                assert.deepStrictEqual(await run(u), ['fallback'], u)
            }
            assert.deepStrictEqual(cdn.getViolations().map((v) => v.url), [
                'https://example.invalid/a.js',
                'https://cdn.fixture.invalid/pkg-0@1.0.0/dist/f0.js?v=2',
                'https://api.example.test.evil.invalid/x',
                'http://127.0.0.1.evil.invalid/',
            ])
        })

        it('[CL30] 本地副本不可用(尚未取得且取得失敗、快取檔被刪)時中止(failed)並記錄為違規, 不放行外網', async function() {
            let cdn = await cdnOf()
            let u = HOST + '/pkg-0@1.0.0/dist/f0.js'
            fs.rmSync(cdn.fileOf(u))
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let r = mkRoute(u)
            await ctx.routes[0][1](r)
            assert.deepStrictEqual(r.calls, [['abort', 'failed']])
            assert.strictEqual(cdn.getViolations().length, 1)
            assert.ok(/本地副本不可用/.test(cdn.getViolations()[0].reason))

            //取得本身失敗(離線缺檔): 每個請求皆中止並記錄
            let off = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('route-off'), offline: true })
            let ctx2 = mkCtx()
            await off.routeBrowser(ctx2)
            let r2 = mkRoute(u)
            await ctx2.routes[0][1](r2)
            assert.deepStrictEqual(r2.calls, [['abort', 'failed']])
            assert.strictEqual(off.getViolations().length, 1)
        })

        it('[CL31] ws(s): 清單只含 http(s), 非放行之連線一律被攔(matcher 為真)並關閉、記錄; 放行者(回送位址、allow)不攔截', async function() {
            let cdn = await cdnOf({ allow: [/^wss:\/\/ok\.example\.test\//] })
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            assert.strictEqual(ctx.wsRoutes.length, 1)
            let [matcher, handler] = ctx.wsRoutes[0]
            assert.strictEqual(matcher(new URL('wss://example.invalid/socket')), true)
            assert.strictEqual(matcher(new URL('ws://127.0.0.1:3000/hmr')), false)
            assert.strictEqual(matcher(new URL('ws://localhost:3000/hmr')), false)
            assert.strictEqual(matcher(new URL('wss://ok.example.test/s')), false)
            let closed = []
            await handler({ url: () => 'wss://example.invalid/socket', close: async (o) => closed.push(o) })
            assert.deepStrictEqual(closed, [{ code: 1008, reason: 'blocked' }])
            assert.deepStrictEqual(cdn.getViolations().map((v) => v.kind + ' ' + v.url), ['websocket wss://example.invalid/socket'])
            let ctx2 = mkCtx()
            delete ctx2.routeWebSocket //舊版 Playwright 無 routeWebSocket: 只掛 HTTP 路由
            await cdn.routeBrowser(ctx2)
            assert.strictEqual(ctx2.routes.length, 1)
        })

        it('[CL32] routeBrowser(browser): 已存在之 context 與其後 newContext／newPage 建立者皆掛路由; close() 於關閉後若有違規拋 E_CDN_EXTERNAL(只拋一次); failOnClose:false 不包裝 close', async function() {
            let cdn = await cdnOf()
            let b = mkBrowser()
            let pre = await b.newContext() //先於 routeBrowser 存在者
            assert.strictEqual(await cdn.routeBrowser(b), b, '回傳傳入之 browser')
            assert.strictEqual(pre.routes.length, 1, '已存在之 context 亦掛路由')
            let c1 = await b.newContext()
            let page = await b.newPage()
            assert.strictEqual(c1.routes.length, 1)
            assert.strictEqual(page.context().routes.length, 1)
            let wrapped = [b.newContext, b.newPage, b.close]
            assert.strictEqual(await cdn.routeBrowser(b), b, '重複呼叫不重複掛')
            assert.strictEqual(pre.routes.length, 1)
            assert.strictEqual(c1.routes.length, 1)
            assert.deepStrictEqual([b.newContext, b.newPage, b.close], wrapped, '重複呼叫不再包裝 newContext／newPage／close')

            //無違規: 正常關閉
            await b.close()
            assert.strictEqual(b.closed, 1)

            //有違規: 關閉後拋錯, 且 bucket 清空(只拋一次)
            let r = mkRoute('https://example.invalid/x.js')
            await c1.routes[0][1](r)
            let err = await b.close().catch((e) => e)
            assert.strictEqual(b.closed, 2, '先真的關閉再拋錯')
            assert.strictEqual(err.code, 'E_CDN_EXTERNAL')
            assert.strictEqual(err.violations.length, 1)
            assert.ok(/example\.invalid\/x\.js/.test(err.message))
            await b.close()
            assert.strictEqual(b.closed, 3, '違規已回報過, 不再拋')

            //failOnClose:false
            let b2 = mkBrowser()
            let close2 = b2.close
            await cdn.routeBrowser(b2, { failOnClose: false })
            assert.strictEqual(b2.close, close2, 'failOnClose:false 不包裝 close')
            let mark = cdn.violationMark()
            let c2 = await b2.newContext()
            await c2.routes[0][1](mkRoute('https://example.invalid/y.js'))
            await assert.doesNotReject(() => b2.close())
            assert.throws(() => cdn.assertNoViolation(mark), (e) => e.code === 'E_CDN_EXTERNAL', 'close 不拋時, 仍由 assertNoViolation 揭露')
        })

        it('[CL33] routeBrowser(context／page): context 直接掛路由並包裝 close; page 取其 context; 非 Playwright 物件拋 E_CDN_ARG', async function() {
            let cdn = await cdnOf()
            let ctx = mkCtx()
            assert.strictEqual(await cdn.routeBrowser(ctx), ctx)
            assert.strictEqual(ctx.routes.length, 1)
            await ctx.routes[0][1](mkRoute('https://example.invalid/z.js'))
            let err = await ctx.close().catch((e) => e)
            assert.strictEqual(ctx.closed, 1)
            assert.strictEqual(err.code, 'E_CDN_EXTERNAL')
            let ctx2 = mkCtx()
            let page = { route: async () => {}, context: () => ctx2 }
            assert.strictEqual(await cdn.routeBrowser(page), ctx2, 'page: 路由掛在其 context, 回傳該 context')
            assert.strictEqual(ctx2.routes.length, 1)
            for (let bad of [null, undefined, {}, 5, 'x', { route: 1 }, { newContext: async () => {} }]) {
                await assert.rejects(() => cdn.routeBrowser(bad), (e) => e.code === 'E_CDN_ARG', String(bad))
            }
        })

        it('[CL34] 掛路由失敗(context 已關閉)時不留下已掛標記, 可重試', async function() {
            let cdn = await cdnOf()
            let ctx = mkCtx()
            let ok = ctx.route
            ctx.route = async () => {
                throw new Error('context closed')
            }
            await assert.rejects(() => cdn.routeBrowser(ctx), /context closed/)
            assert.strictEqual(ctx.listeners.length, 0, '失敗時已掛之 request、requestfinished 觀察者一併移除')
            assert.strictEqual(cdn.isRouted(ctx), false)
            ctx.route = ok
            await cdn.routeBrowser(ctx)
            assert.strictEqual(ctx.routes.length, 1)
            assert.deepStrictEqual(ctx.listeners.map(([e]) => e), ['request', 'requestfinished'], 'request 與 requestfinished 兩個觀察者各掛一次')
            assert.strictEqual(cdn.isRouted(ctx), true)
        })

        it('[CL34b] 路由已掛而 routeWebSocket 失敗時: 已掛之路由處理器一併移除(unroute)、觀察者移除、不留已掛標記, 重試成功後只有一層路由', async function() {
            let cdn = await cdnOf()
            let ctx = mkCtx()
            let okWs = ctx.routeWebSocket
            ctx.routeWebSocket = async () => {
                throw new Error('websocket route failed')
            }
            await assert.rejects(() => cdn.routeBrowser(ctx), /websocket route failed/)
            assert.strictEqual(ctx.routes.length, 0, '已掛之路由處理器被移除')
            assert.strictEqual(ctx.listeners.length, 0)
            assert.strictEqual(cdn.isRouted(ctx), false)
            ctx.routeWebSocket = okWs
            await cdn.routeBrowser(ctx)
            assert.strictEqual(ctx.routes.length, 1, '重試後只有一層路由(不疊兩層)')
            assert.strictEqual(ctx.wsRoutes.length, 1)
            assert.strictEqual(cdn.isRouted(ctx), true)

            //unroute 本身失敗不蓋掉原錯誤
            let ctx2 = mkCtx()
            ctx2.routeWebSocket = async () => {
                throw new Error('ws failed 2')
            }
            ctx2.unroute = async () => {
                throw new Error('unroute failed')
            }
            await assert.rejects(() => cdn.routeBrowser(ctx2), /ws failed 2/)
        })

        it('[CL39] 對 browser 掛路由失敗(已存在之 context 掛不上)時還原 newContext／newPage 之包裝與標記, 可重試; 重試成功後其後建立者皆掛路由', async function() {
            let cdn = await cdnOf()
            let b = mkBrowser()
            let bad = await b.newContext()
            let okRoute = bad.route
            bad.route = async () => {
                throw new Error('context closed')
            }
            let nc = b.newContext
            let np = b.newPage
            await assert.rejects(() => cdn.routeBrowser(b), /context closed/)
            assert.strictEqual(b.newContext, nc, 'newContext 已還原')
            assert.strictEqual(b.newPage, np, 'newPage 已還原')
            assert.strictEqual(cdn.isRouted(b), false)
            bad.route = okRoute
            await cdn.routeBrowser(b)
            assert.strictEqual(cdn.isRouted(b), true)
            assert.notStrictEqual(b.newContext, nc, '重試成功後已包裝')
            let c = await b.newContext()
            assert.strictEqual(c.routes.length, 1)
            assert.strictEqual(bad.routes.length, 1)

            //Playwright 之 browser 之 newContext 為原型方法(非自有屬性): 還原後應回到原型方法(不留自有屬性)
            class Br {
                constructor() {
                    this.made = []
                }

                contexts() {
                    return this.made
                }

                async newContext() {
                    let x = mkCtx()
                    x.route = async () => {
                        throw new Error('closed')
                    }
                    this.made.push(x)
                    return x
                }

                async newPage() {
                    return { context: () => mkCtx() }
                }

                async close() {}
            }
            let pb = new Br()
            await pb.newContext()
            await assert.rejects(() => cdn.routeBrowser(pb), /closed/)
            assert.ok(!Object.prototype.hasOwnProperty.call(pb, 'newContext') && !Object.prototype.hasOwnProperty.call(pb, 'newPage'), '還原後不留自有屬性')
        })

        it('[CL40] isRouted: browser、context、page(其 context)經 routeBrowser 後為 true; 未掛者與非物件為 false; 標記只屬於本實例(另一實例視為未掛)', async function() {
            let cdn = await cdnOf()
            let other = await cdnOf()
            let b = mkBrowser()
            let c = mkCtx()
            let ctxOfPage = mkCtx()
            let page = { route: async () => {}, context: () => ctxOfPage }
            assert.deepStrictEqual([cdn.isRouted(b), cdn.isRouted(c), cdn.isRouted(page)], [false, false, false])
            await cdn.routeBrowser(b)
            await cdn.routeBrowser(c)
            await cdn.routeBrowser(page)
            assert.deepStrictEqual([cdn.isRouted(b), cdn.isRouted(c), cdn.isRouted(page), cdn.isRouted(ctxOfPage)], [true, true, true, true])
            let made = await b.newContext()
            assert.strictEqual(cdn.isRouted(made), true, 'browser 其後建立之 context')
            assert.deepStrictEqual([other.isRouted(b), other.isRouted(c), other.isRouted(page)], [false, false, false], '標記屬於實例')
            for (let bad of [null, undefined, 5, 'x', {}, [], () => {}]) {
                assert.strictEqual(cdn.isRouted(bad), false)
            }
            await other.routeBrowser(c)
            assert.strictEqual(c.routes.length, 2, '另一實例對同一 context 亦各自掛路由')
        })

        it('[CL41] request 事件之觀察者: route 攔不到之外部請求(重新導向、使用端先於本處理器放走)記為違規; 同一請求 route 處理器與觀察者各看到一次只記一筆(不論先後); 清單內、放行、非網路者不記', async function() {
            let cdn = await cdnOf({ allow: [/^https:\/\/api\.example\.test\//] })
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            assert.deepStrictEqual(ctx.listeners.map(([e]) => e), ['request', 'requestfinished'])
            assert.strictEqual(ctx.listeners[0][0], 'request')
            let obs = ctx.listeners[0][1]
            let h = ctx.routes[0][1]

            //觀察者先(實測 Chromium：事件先於 route): 記一筆, 其後 route 處理器看到同一個請求不再記
            let r1 = mkReq('https://example.invalid/a.js')
            obs(r1)
            await h(mkRoute(r1.url(), r1))
            assert.deepStrictEqual(cdn.getViolations().map((v) => [v.kind, v.url, v.reason]), [['browser', 'https://example.invalid/a.js', '未列入 CDN 本地對照表之外部請求']])

            //route 處理器先: 記一筆, 其後觀察者不再記
            let r2 = mkReq('https://example.invalid/b.js')
            await h(mkRoute(r2.url(), r2))
            obs(r2)
            assert.strictEqual(cdn.getViolations().length, 2)

            //route 看不到者: 重新導向之後續請求、被放走者
            obs(mkReq('https://example.invalid/redirected.js', true))
            obs(mkReq('https://example.invalid/passed.js'))
            let vs = cdn.getViolations()
            assert.strictEqual(vs.length, 4)
            assert.ok(/重新導向/.test(vs[2].reason) && !/重新導向/.test(vs[3].reason))

            //不記: 清單內、放行(回送位址、allow)、非網路、同一請求不同物件(各自為獨立請求)
            obs(mkReq(HOST + '/pkg-0@1.0.0/dist/f0.js'))
            obs(mkReq('http://127.0.0.1:8080/x'))
            obs(mkReq('https://api.example.test/x'))
            obs(mkReq('data:text/plain,x'))
            obs(mkReq('blob:http://x/1'))
            assert.strictEqual(cdn.getViolations().length, 4)
            obs(mkReq('https://example.invalid/passed.js'))
            assert.strictEqual(cdn.getViolations().length, 5, '另一個請求物件為另一個請求, 各記一筆')

            //觀察者之內部錯誤不外洩
            assert.doesNotThrow(() => obs({
                url: () => {
                    throw new Error('boom')
                }
            }))
            assert.doesNotThrow(() => obs(null))
        })

        it('[CL42] 清單項目之 type 優先於副檔名(content-type): 路由與 Node 端 fetch 皆以 type 回應; 未給 type 者依副檔名', async function() {
            let body = Buffer.from('a{color:red}')
            let u1 = 'https://cdn.fixture.invalid/css2?family=Roboto'
            let u2 = 'https://cdn.fixture.invalid/mod'
            let u3 = 'https://cdn.fixture.invalid/plain.css'
            let u4 = 'https://cdn.fixture.invalid/typed.css'
            let m = {
                schema: 1,
                files: {
                    [u1]: { sha256: sha(body), size: body.length, type: 'text/css; charset=utf-8' },
                    [u2]: { sha256: sha(body), size: body.length },
                    [u3]: { sha256: sha(body), size: body.length },
                    [u4]: { sha256: sha(body), size: body.length, type: 'text/plain' },
                }
            }
            let cdn = createCdnLocal({ manifest: m, cacheDir: dirOf('types'), fetch: async () => new Response(body), retryDelayMs: 10 })
            await cdn.ensure()
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let types = {}
            for (let u of [u1, u2, u3, u4]) {
                let r = mkRoute(u)
                await ctx.routes[0][1](r)
                types[u] = r.calls[0][1].headers['content-type']
            }
            assert.deepStrictEqual(types, {
                [u1]: 'text/css; charset=utf-8',
                [u2]: 'application/octet-stream',
                [u3]: 'text/css; charset=utf-8',
                [u4]: 'text/plain',
            })
            let restore = cdn.patchFetch()
            try {
                assert.strictEqual((await fetch(u1)).headers.get('content-type'), 'text/css; charset=utf-8')
                assert.strictEqual((await fetch(u4)).headers.get('content-type'), 'text/plain')
                assert.strictEqual((await fetch(u2)).headers.get('content-type'), 'application/octet-stream')
            }
            finally {
                restore()
            }
        })

        it('[CL43] requestfinished 之觀察者(R-CL-12): 清單內之網址之請求完成而不是由本處理器供應者(使用端之 route 以 continue() 等放走)記為違規; 已由本處理器 fulfill 者不記(含 fulfill 之 Promise 尚未解決時事件已到); 清單外、放行、非網路者不在此重複記; 同一請求只記一筆', async function() {
            let cdn = await cdnOf({ allow: [/^https:\/\/api\.example\.test\//] })
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let fin = ctx.listeners.find(([e]) => e === 'requestfinished')[1]
            let h = ctx.routes[0][1]
            let u0 = HOST + '/pkg-0@1.0.0/dist/f0.js'
            let u1 = HOST + '/pkg-1@1.0.1/dist/f1.js'
            let mark = cdn.violationMark()

            //本處理器已 fulfill: 完成時不記
            let r0 = mkReq(u0)
            await h(mkRoute(u0, r0))
            fin(r0)
            cdn.assertNoViolation(mark)

            //fulfill 之 Promise 尚未解決時 requestfinished 已到(標記先於 fulfill): 不記
            let r1 = mkReq(u1)
            let route1 = mkRoute(u1, r1)
            route1.fulfill = async (o) => {
                fin(r1)
                route1.calls.push(['fulfill', o])
            }
            await h(route1)
            cdn.assertNoViolation(mark)
            assert.strictEqual(route1.calls[0][0], 'fulfill')

            //本處理器未見到該請求(使用端之 route 先於本處理器執行並 continue() 放走): 完成時記違規, 理由指明未由本地副本供應
            let r2 = mkReq(u0)
            fin(r2)
            let vs = cdn.getViolations()
            assert.strictEqual(vs.length, 1)
            assert.deepStrictEqual([vs[0].kind, vs[0].url], ['browser', u0])
            assert.ok(/未由本地副本供應/.test(vs[0].reason), vs[0].reason)
            assert.throws(() => cdn.assertNoViolation(mark), (err) => err.code === 'E_CDN_EXTERNAL' && err.violations.length === 1)

            //同一請求再完成: 只記一筆(依 Request 物件去重)
            fin(r2)
            assert.strictEqual(cdn.getViolations().length, 1)

            //片段不計(同一網址); 另一個請求物件為另一個請求, 各記一筆
            fin(mkReq(u1 + '#frag'))
            assert.strictEqual(cdn.getViolations().length, 2)

            //不在此記: 清單外(由 request 觀察者記)、放行(回送位址、allow)、非網路請求
            let n = cdn.getViolations().length
            fin(mkReq('https://example.invalid/a.js'))
            fin(mkReq(u0 + '?v=2'))
            fin(mkReq('http://127.0.0.1:8080/x'))
            fin(mkReq('https://api.example.test/x'))
            fin(mkReq('data:text/plain,x'))
            fin(mkReq('blob:http://x/1'))
            assert.strictEqual(cdn.getViolations().length, n)

            //觀察者之內部錯誤不外洩
            assert.doesNotThrow(() => fin({
                url: () => {
                    throw new Error('boom')
                }
            }))
            assert.doesNotThrow(() => fin(null))
        })

        it('[CL43b] requestfinished 之觀察者: 清單列了回送位址之網址(清單優先於放行)而請求未由本處理器供應者亦記違規; 本處理器因本地副本不可用已記之請求, 完成事件不重複記', async function() {
            let body = Buffer.from('loop-body')
            let loop = 'http://127.0.0.1:8123/lib.js'
            let cdn = createCdnLocal({ manifest: { schema: 1, files: { [loop]: { sha256: sha(body), size: body.length } } }, cacheDir: dirOf('finloop'), fetch: async () => new Response(body), retryDelayMs: 10 })
            await cdn.ensure()
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let fin = ctx.listeners.find(([e]) => e === 'requestfinished')[1]
            fin(mkReq(loop))
            let vs = cdn.getViolations()
            assert.strictEqual(vs.length, 1)
            assert.strictEqual(vs[0].url, loop)
            assert.ok(/未由本地副本供應/.test(vs[0].reason))
            fin(mkReq('http://127.0.0.1:8123/other.js')) //清單外之回送位址: 放行, 不記
            assert.strictEqual(cdn.getViolations().length, 1)

            //本地副本不可用(離線缺檔)之請求: 處理器已記並中止, 其完成事件(若有)不重複記
            let off = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('finoff'), offline: true })
            let ctx2 = mkCtx()
            await off.routeBrowser(ctx2)
            let u = HOST + '/pkg-0@1.0.0/dist/f0.js'
            let r = mkReq(u)
            await ctx2.routes[0][1](mkRoute(u, r))
            assert.strictEqual(off.getViolations().length, 1)
            ctx2.listeners.find(([e]) => e === 'requestfinished')[1](r)
            assert.strictEqual(off.getViolations().length, 1)
        })

        it('[CL44] routeLaunch(next, ...args)(R-CL-14): 啟動後掛路由並回傳同一個 browser, 引數原樣傳給 next; next 非函數拋 E_CDN_ARG; next 拋錯原樣傳出且不掛路由', async function() {
            let cdn = await cdnOf()
            let b = mkBrowser()
            let seen = null
            let got = await cdn.routeLaunch(async (...a) => {
                seen = a
                return b
            }, 1, 'x', { y: 2 })
            assert.strictEqual(got, b)
            assert.deepStrictEqual(seen, [1, 'x', { y: 2 }])
            assert.strictEqual(cdn.isRouted(b), true)
            await b.newContext()
            assert.strictEqual(b.made[0].routes.length, 1, '其後建立之 context 亦掛路由')

            for (let bad of [undefined, null, 'x', 5, {}]) {
                await assert.rejects(() => cdn.routeLaunch(bad), (err) => err.code === 'E_CDN_ARG', String(bad))
            }

            let boom = new Error('start failed')
            let b2 = mkBrowser()
            await assert.rejects(() => cdn.routeLaunch(async () => {
                throw boom
            }), (err) => err === boom)
            assert.strictEqual(cdn.isRouted(b2), false)
        })

        it('[CL45] routeLaunch: 掛路由失敗(browser 替身拋錯)時先關閉已啟動之瀏覽器、原錯誤原樣拋出、原因(經遮蔽)印到 stderr、發 route-launch-failed 事件; close 本身失敗或無 close 不蓋掉原錯誤', async function() {
            let events = []
            let cdn = await cdnOf({ onTrace: (e) => events.push(e) })
            let lines = []
            let orig = console.error
            console.error = (...a) => lines.push(a.join(' '))
            try {
                //已存在之 context 掛不上: routeBrowser 拋錯
                let b = mkBrowser()
                let bad = await b.newContext()
                let secret = 'https://x.invalid/a.js?token=SECRETVALUE123'
                bad.route = async () => {
                    let err = new Error('route failed ' + secret)
                    err.code = 'E_BOOM'
                    throw err
                }
                await assert.rejects(() => cdn.routeLaunch(async () => b), (err) => err.code === 'E_BOOM')
                assert.strictEqual(b.closed, 1, '失敗時關閉已啟動之瀏覽器')
                assert.strictEqual(cdn.isRouted(b), false)
                assert.strictEqual(lines.length, 1)
                assert.ok(/routeLaunch: 掛路由失敗\(code E_BOOM\)/.test(lines[0]), lines[0])
                assert.ok(!lines[0].includes('SECRETVALUE123'), '原因經 maskDiagText 遮蔽查詢秘密值: ' + lines[0])
                assert.deepStrictEqual(events.filter((e) => e.type === 'route-launch-failed').map((e) => e.code), ['E_BOOM'])

                //close 本身拋錯: 仍拋原錯誤
                let b2 = mkBrowser()
                let bad2 = await b2.newContext()
                bad2.route = async () => {
                    throw new Error('route failed 2')
                }
                b2.close = async () => {
                    throw new Error('close failed')
                }
                await assert.rejects(() => cdn.routeLaunch(async () => b2), /route failed 2/)

                //非 Playwright 物件(無 close): routeBrowser 拋 E_CDN_ARG, 不因缺 close 而改拋 TypeError
                await assert.rejects(() => cdn.routeLaunch(async () => ({})), (err) => err.code === 'E_CDN_ARG')
                assert.strictEqual(lines.length, 3)
            }
            finally {
                console.error = orig
            }
        })

        //useMocha 之替身: 收集各掛鉤之函數, 由測試依序呼叫(以含 timeout 之物件為 this), 不依賴 mocha 全域
        let mkHooks = () => {
            let h = { before: [], beforeEach: [], afterEach: [], after: [] }
            let api = {}
            for (let k of Object.keys(h)) {
                api[k] = (fn) => h[k].push(fn)
            }
            return { h, api }
        }

        it('[CL46] useMocha(R-CL-14): 預設註冊 before(this.timeout 對齊下載預算並取得)、beforeEach／afterEach(每案前取標記、案後斷言自標記起無新增違規, 前一案之違規不連累下一案)', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('um'), fetch: srv.fetch, retryDelayMs: 10 })
                let { h, api } = mkHooks()
                cdn.useMocha({ hooks: api })
                assert.deepStrictEqual([h.before.length, h.beforeEach.length, h.afterEach.length, h.after.length], [1, 1, 1, 0])
                let timeouts = []
                await h.before[0].call({ timeout: (ms) => timeouts.push(ms) })
                assert.deepStrictEqual(timeouts, [cdn.hookTimeoutMs], 'before 之時限對齊 hookTimeoutMs')
                assert.strictEqual(cdn.stats().ready, true, 'before 內已取得')

                //案 1: 有違規 → afterEach 拋 E_CDN_EXTERNAL
                h.beforeEach[0]()
                let ctx = mkCtx()
                await cdn.routeBrowser(ctx)
                await ctx.routes[0][1](mkRoute('https://example.invalid/a.js'))
                assert.throws(() => h.afterEach[0](), (err) => err.code === 'E_CDN_EXTERNAL' && err.violations.length === 1)

                //案 2: 無新違規 → 不拋(標記每案重取, 案 1 之違規不計)
                h.beforeEach[0]()
                assert.doesNotThrow(() => h.afterEach[0]())

                //before 之 this 無 timeout 函數(非 mocha 環境之替身)時不拋
                let { h: h2, api: api2 } = mkHooks()
                cdn.useMocha({ hooks: api2 })
                await assert.doesNotReject(() => h2.before[0].call({}))
            }
            finally {
                await srv.close()
            }
        })

        it('[CL47] useMocha 之選項: ensure:false 不取得、guard:false 不夾違規斷言、install 於取得之後以 routeLaunch 呼叫並於 after 還原一次(含回傳 Promise 之函數、回傳非函數), 缺掛鉤拋 E_CDN_ARG', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let mk = () => createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('um2'), fetch: srv.fetch, retryDelayMs: 10 })

                //ensure:false、guard:false: 無任何掛鉤
                let c1 = mk()
                let a = mkHooks()
                c1.useMocha({ hooks: a.api, ensure: false, guard: false })
                assert.deepStrictEqual([a.h.before.length, a.h.beforeEach.length, a.h.afterEach.length, a.h.after.length], [0, 0, 0, 0])

                //只 guard: 有 beforeEach／afterEach, 無 before; 非布林之 ensure／guard 視為未給(取預設 true)
                let c2 = mk()
                let b = mkHooks()
                c2.useMocha({ hooks: b.api, ensure: false })
                assert.deepStrictEqual([b.h.before.length, b.h.beforeEach.length, b.h.afterEach.length], [0, 1, 1])
                let c2b = mk()
                let b2 = mkHooks()
                c2b.useMocha({ hooks: b2.api, ensure: 'no', guard: 0 })
                assert.deepStrictEqual([b2.h.before.length, b2.h.beforeEach.length, b2.h.afterEach.length], [1, 1, 1])

                //install: 取得後呼叫, 收到之 routeLaunch 即本實例之 routeLaunch(呼叫之會掛路由); 還原一次
                let c3 = mk()
                let c = mkHooks()
                let order = []
                let restored = 0
                let gotLaunch = null
                c3.useMocha({
                    hooks: c.api,
                    install: async (rl) => {
                        order.push('install:' + c3.stats().ready)
                        gotLaunch = rl
                        return () => {
                            restored++
                        }
                    },
                })
                assert.deepStrictEqual([c.h.before.length, c.h.after.length], [1, 1])
                await c.h.before[0].call({ timeout() {} })
                assert.deepStrictEqual(order, ['install:true'], '取得(ready)之後才安裝')
                let br = mkBrowser()
                assert.strictEqual(await gotLaunch(async () => br), br)
                assert.strictEqual(c3.isRouted(br), true)
                c.h.after[0]()
                c.h.after[0]()
                assert.strictEqual(restored, 1, '還原只呼叫一次')

                //install 回傳非函數: 不當還原函數, after 不拋
                let c4 = mk()
                let d = mkHooks()
                c4.useMocha({ hooks: d.api, ensure: false, install: () => 'not a function' })
                await d.h.before[0].call({})
                assert.doesNotThrow(() => d.h.after[0]())

                //缺掛鉤(非 mocha 環境且未給 hooks): E_CDN_ARG 並指明缺哪個
                for (let [opt, miss] of [[{ hooks: {} }, 'before'], [{ hooks: { before() {} } }, 'beforeEach'], [{ hooks: { before() {}, beforeEach() {} } }, 'afterEach'], [{ hooks: { before() {}, beforeEach() {}, afterEach() {} }, install: () => {} }, 'after']]) {
                    assert.throws(() => mk().useMocha(opt), (err) => err.code === 'E_CDN_ARG' && err.message.includes(miss), miss)
                }
            }
            finally {
                await srv.close()
            }
        })

    })


    describe('mime(R-CL-6)', function() {

        it('[CL27] cdnMimeOf: 依副檔名(去查詢與片段)回 content-type, 未知或無副檔名為 octet-stream, 無效網址不拋', function() {
            let cases = [
                ['https://x/a.js', 'application/javascript; charset=utf-8'],
                ['https://x/a.mjs?v=1', 'application/javascript; charset=utf-8'],
                ['https://x/a.cjs', 'application/javascript; charset=utf-8'],
                ['https://x/a.CSS#h', 'text/css; charset=utf-8'],
                ['https://x/a.json', 'application/json; charset=utf-8'],
                ['https://x/a.js.map', 'application/json; charset=utf-8'],
                ['https://x/a.wasm', 'application/wasm'],
                ['https://x/a.svg', 'image/svg+xml'],
                ['https://x/a.woff2', 'font/woff2'],
                ['https://x/a.png', 'image/png'],
                ['https://x/a.unknown', 'application/octet-stream'],
                ['https://x/noext', 'application/octet-stream'],
                ['https://x/', 'application/octet-stream'],
                ['not a url', 'application/octet-stream'],
                [undefined, 'application/octet-stream'],
            ]
            for (let [u, m] of cases) {
                assert.strictEqual(cdnMimeOf(u), m, String(u))
            }
        })

    })

})
