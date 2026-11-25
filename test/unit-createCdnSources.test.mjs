import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import createCdnLocal from '../src/createCdnLocal.mjs'
import { HOST, sha, makeFixture, startServer, mkCtx, mkRoute, mkReq } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md R-CL-13(opt.sources 本機檔來源、opt.stubs 空腳本)、R-CL-15(opt.loopbackPorts 只放行指定回送埠)
//  夾具伺服器與本機檔皆在本機, 不連外網; 「外部網址」為 https://cdn.fixture.invalid(不可解析之主機)

let fdTmp = fileURLToPath(new URL('./_tmp/createCdnSources/', import.meta.url))
let n = 0
let dirOf = (name) => path.join(fdTmp, `${name}-${++n}`)
let EMPTY = sha(Buffer.alloc(0))
let partsOf = (cache) => fs.readdirSync(cache).filter((f) => /\.part$/.test(f))
let urlOf = (i) => HOST + `/pkg-${i}@1.0.${i}/dist/f${i}.js`

//不得連網之 fetch(本機來源之案不應下載): 被呼叫即記錄並拋錯
let noFetch = () => {
    let calls = []
    let f = async (u) => {
        calls.push(String(u))
        throw new Error('不得連網')
    }
    f.calls = calls
    return f
}


describe('unit-createCdnSources', function() {
    let fx = makeFixture(6)

    //本機檔: 每個夾具腳本一份(內容與清單相符)
    let fdSrc = null
    let srcOf = null

    before(function() {
        fs.mkdirSync(fdTmp, { recursive: true })
        fdSrc = path.join(fdTmp, 'local-files')
        fs.mkdirSync(fdSrc, { recursive: true })
        for (let i = 0; i < 6; i++) {
            fs.writeFileSync(path.join(fdSrc, `f${i}.js`), fx.bodies[`/pkg-${i}@1.0.${i}/dist/f${i}.js`])
        }
        srcOf = (i) => path.join(fdSrc, `f${i}.js`)
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })


    describe('opt.sources 之檢核(R-CL-13)', function() {

        it('[CS01] 給了而無效即拋 E_CDN_ARG(fail-closed): 非物件、路徑非非空字串或含 NUL、網址不在清單內或無法解析、同網址正規化後重複、與 opt.stubs 並列; 未給／null 視為未給; 訊息不回顯路徑', function() {
            let mk = (sources) => createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('arg'), sources })
            for (let bad of ['x', 5, true, ['a'], new Map([[urlOf(0), srcOf(0)]]), new Set([urlOf(0)]), new (class Src {})(), () => {}]) {
                assert.throws(() => mk(bad), (err) => err.code === 'E_CDN_ARG' && /opt\.sources/.test(err.message), String(bad))
            }
            assert.doesNotThrow(() => mk(Object.create(null)), '無原型之物件亦為一般物件')
            for (let p of [5, '', null, undefined, {}, [], 'a\0b']) {
                assert.throws(() => mk({ [urlOf(0)]: p }), (err) => err.code === 'E_CDN_ARG' && /第 1 項之檔案路徑/.test(err.message), String(p))
            }
            //網址不在清單內(含只差查詢、清單外之其他主機、無法解析者)
            for (let u of [HOST + '/other.js', urlOf(0) + '?v=2', 'https://other.invalid/x.js', 'not a url', '']) {
                assert.throws(() => mk({ [urlOf(1)]: srcOf(1), [u]: srcOf(0) }), (err) => err.code === 'E_CDN_ARG' && /第 2 項之網址不在清單內/.test(err.message) && !err.message.includes(srcOf(0)), String(u))
            }
            //同網址正規化後重複(大小寫主機、預設埠、片段)
            assert.throws(() => mk({ [urlOf(0)]: srcOf(0), ['https://CDN.FIXTURE.INVALID:443' + urlOf(0).slice(HOST.length) + '#h']: srcOf(0) }), (err) => err.code === 'E_CDN_ARG' && /正規化後相同/.test(err.message))
            //與 stubs 並列
            assert.throws(() => createCdnLocal({ manifest: { schema: 1, files: { [urlOf(0)]: { sha256: EMPTY, size: 0 } } }, cacheDir: dirOf('arg'), stubs: [urlOf(0)], sources: { [urlOf(0)]: srcOf(0) } }), (err) => err.code === 'E_CDN_ARG' && /opt\.stubs/.test(err.message))
            //未給、null: 視為未給
            assert.doesNotThrow(() => mk(undefined))
            assert.doesNotThrow(() => mk(null))
            assert.doesNotThrow(() => mk({}))
            //有效(含相對路徑、網址帶片段)
            assert.doesNotThrow(() => mk({ [urlOf(0) + '#frag']: path.relative(process.cwd(), srcOf(0)) }))
        })

    })


    describe('opt.sources 之取得(R-CL-13)', function() {

        it('[CS02] 全部由本機檔供應: 不連網(fetch 未被呼叫)、內容經清單之 sha256 與大小校驗後入內容定址快取、無下載紀錄、無暫存檔與鎖; stats().sourced 計入; 事件 sourced; 之後路由與 Node 端 fetch 皆回該內容', async function() {
            let cache = dirOf('all')
            let f = noFetch()
            let events = []
            let sources = {}
            for (let i = 0; i < 6; i++) {
                sources[urlOf(i)] = srcOf(i)
            }
            let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, sources, fetch: f, onTrace: (e) => events.push(e) })
            await cdn.ensure()
            assert.deepStrictEqual(f.calls, [], '本機來源不得連網')
            let st = cdn.stats()
            assert.deepStrictEqual([st.files, st.contents, st.ready, st.downloaded, st.sourced, st.stubs], [6, 6, true, 0, 6, 0])
            for (let i = 0; i < 6; i++) {
                let body = fx.bodies[`/pkg-${i}@1.0.${i}/dist/f${i}.js`]
                assert.deepStrictEqual(fs.readFileSync(path.join(cache, sha(body))), body, `快取內容 ${i}`)
            }
            assert.strictEqual(fs.existsSync(cdn.journalFp), false, '沒有下載就沒有下載紀錄')
            assert.deepStrictEqual(partsOf(cache), [])
            assert.strictEqual(fs.existsSync(cdn.lockDir), false, '鎖已釋放')
            assert.deepStrictEqual(events.filter((e) => e.type === 'sourced').map((e) => e.kind), ['file', 'file', 'file', 'file', 'file', 'file'])
            assert.strictEqual(events.filter((e) => e.type === 'downloaded').length, 0)

            //路由(替身)與 Node 端 fetch 供應之位元組即清單所釘選者
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let r = mkRoute(urlOf(3))
            await ctx.routes[0][1](r)
            assert.strictEqual(sha(r.calls[0][1].body), fx.manifest.files[urlOf(3)].sha256)
            let restore = cdn.patchFetch()
            try {
                let res = await fetch(urlOf(4))
                assert.strictEqual(sha(Buffer.from(await res.arrayBuffer())), fx.manifest.files[urlOf(4)].sha256)
            }
            finally {
                restore()
            }
        })

        it('[CS03] 部分有本機來源: 有來源者取自本機檔、其餘照常下載(伺服器只收到無來源者之請求); stats 之 sourced 與 downloaded 分計', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('mixed')
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, sources: { [urlOf(0)]: srcOf(0), [urlOf(2)]: srcOf(2), [urlOf(4)]: srcOf(4) }, fetch: srv.fetch, retryDelayMs: 10 })
                await cdn.ensure()
                assert.deepStrictEqual(Object.keys(srv.hits).sort(), [1, 3, 5].map((i) => `/pkg-${i}@1.0.${i}/dist/f${i}.js`).sort())
                let st = cdn.stats()
                assert.deepStrictEqual([st.sourced, st.downloaded, st.ready], [3, 3, true])
                assert.strictEqual(fs.readFileSync(cdn.journalFp, 'utf8').trim().split('\n').length, 3, '下載紀錄只有下載之 3 列')
            }
            finally {
                await srv.close()
            }
        })

        it('[CS04] 本機檔與清單不符一律拒收(E_CDN_SOURCE, 帶 reason)且不改走下載: sha256 不符(同長度)、大小不符、缺檔、非一般檔案、無法讀取; 快取不留該內容與暫存檔、鎖已釋放、失敗被記住; 訊息不含路徑與 sha256', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let good = fx.bodies['/pkg-0@1.0.0/dist/f0.js']
                let same = Buffer.from(good) //同長度、內容不同
                same[same.length - 1] ^= 0x01
                let fpSame = path.join(fdSrc, 'bad-same.js')
                let fpShort = path.join(fdSrc, 'bad-short.js')
                fs.writeFileSync(fpSame, same)
                fs.writeFileSync(fpShort, good.subarray(0, good.length - 1))
                let cases = [
                    ['sha256-mismatch', fpSame],
                    ['size-mismatch', fpShort],
                    ['missing', path.join(fdSrc, 'nope.js')],
                    ['not-file', fdSrc],
                ]
                for (let [reason, fp] of cases) {
                    let cache = dirOf('bad')
                    let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, sources: { [urlOf(0)]: fp }, fetch: srv.fetch, retryDelayMs: 10 })
                    let err = await cdn.ensure().then(() => null, (e) => e)
                    assert.ok(err, reason)
                    assert.strictEqual(err.code, 'E_CDN_SOURCE', reason)
                    assert.strictEqual(err.reason, reason)
                    assert.ok(!err.message.includes(fp) && !err.message.includes(fx.manifest.files[urlOf(0)].sha256), '訊息不得含路徑與 sha256: ' + err.message)
                    assert.ok(err.message.includes(urlOf(0)), '訊息指明網址')
                    assert.strictEqual(fs.existsSync(path.join(cache, fx.manifest.files[urlOf(0)].sha256)), false, '不留未驗證之內容')
                    assert.deepStrictEqual(partsOf(cache), [], '無暫存檔')
                    assert.strictEqual(fs.existsSync(cdn.lockDir), false, '鎖已釋放')
                    assert.deepStrictEqual(srv.hits, {}, '不改走下載')
                    assert.strictEqual(cdn.stats().ready, false)
                    assert.strictEqual(await cdn.ensure().then(() => null, (e) => e), err, '失敗被記住(同一個錯誤)')
                }
            }
            finally {
                await srv.close()
            }
        })

        it('[CS04b] 寫入快取失敗(快取目標被占用): 原生 fs 錯誤包成 E_CDN_SOURCE(reason cache-write, 原錯誤置於 cause), 訊息不含路徑與 sha256, 不留暫存檔, 鎖已釋放; 本機檔與空腳本兩種來源皆然', async function() {
            for (let kind of ['file', 'empty']) {
                let cache = dirOf('cw')
                let ent = kind === 'file' ? fx.manifest.files[urlOf(0)] : { sha256: EMPTY, size: 0 }
                fs.mkdirSync(path.join(cache, ent.sha256, 'occupied'), { recursive: true }) //快取目標為非空資料夾: 讀寫與校驗皆通過, 但更名入快取必失敗
                let extra = kind === 'file' ? { sources: { [urlOf(0)]: srcOf(0) } } : { stubs: [urlOf(0)] }
                let cdn = createCdnLocal({ manifest: { schema: 1, files: { [urlOf(0)]: ent } }, cacheDir: cache, fetch: noFetch(), ...extra })
                let err = await cdn.ensure().then(() => null, (e) => e)
                assert.ok(err, kind)
                assert.strictEqual(err.code, 'E_CDN_SOURCE', kind)
                assert.strictEqual(err.reason, 'cache-write', kind)
                assert.ok(err.cause && err.cause !== err, '原錯誤置於 cause')
                assert.ok(!err.message.includes(cache) && !err.message.includes(ent.sha256), '訊息不得含路徑與 sha256: ' + err.message)
                assert.deepStrictEqual(partsOf(cache), [], '無暫存檔')
                assert.strictEqual(fs.existsSync(cdn.lockDir), false, '鎖已釋放')
                assert.strictEqual(cdn.stats().ready, false)
            }
        })

        it('[CS04c] 寫入快取失敗發生於串流階段(取得鎖後快取資料夾被移除, 暫存檔建不出來): 歸為 cache-write 而不是 unreadable(來源檔本身可讀), 不改走下載', async function() {
            let cache = dirOf('cw2')
            let cdn = createCdnLocal({
                manifest: { schema: 1, files: { [urlOf(0)]: fx.manifest.files[urlOf(0)] } },
                cacheDir: cache,
                sources: { [urlOf(0)]: srcOf(0) },
                fetch: noFetch(),
                onTrace: (e) => {
                    if (e.type === 'lock-acquired') {
                        fs.rmSync(cache, { recursive: true, force: true }) //事件同步呼叫: 取得鎖之當下移除整個快取資料夾
                    }
                },
            })
            let err = await cdn.ensure().then(() => null, (e) => e)
            assert.ok(err)
            assert.strictEqual(err.code, 'E_CDN_SOURCE')
            assert.strictEqual(err.reason, 'cache-write', '來源檔可讀, 失敗在寫入快取之一端')
            assert.ok(err.cause)
            assert.ok(!err.message.includes(cache))
        })

        it('[CS05] 快取已備妥者不讀本機檔(來源其後被刪或改亦不影響); 快取內檔案損毀(同長度內容不同)時自本機來源重補、不連網', async function() {
            let cache = dirOf('cached')
            let local = path.join(fdSrc, 'tmp-copy.js')
            let body = fx.bodies['/pkg-0@1.0.0/dist/f0.js']
            fs.writeFileSync(local, body)
            let one = { schema: 1, files: { [urlOf(0)]: fx.manifest.files[urlOf(0)] } }
            let c1 = createCdnLocal({ manifest: one, cacheDir: cache, sources: { [urlOf(0)]: local }, fetch: noFetch() })
            await c1.ensure()
            fs.rmSync(local) //來源被刪
            let f2 = noFetch()
            let c2 = createCdnLocal({ manifest: one, cacheDir: cache, sources: { [urlOf(0)]: local }, fetch: f2 })
            await c2.ensure()
            assert.deepStrictEqual([c2.stats().ready, c2.stats().sourced, f2.calls.length], [true, 0, 0], '快取已備妥, 不取鎖、不讀來源')

            //損毀快取: 來源仍在時由來源重補
            fs.writeFileSync(local, body)
            let fpCache = path.join(cache, fx.manifest.files[urlOf(0)].sha256)
            let broken = Buffer.from(body)
            broken[0] ^= 0x01
            fs.writeFileSync(fpCache, broken)
            let c3 = createCdnLocal({ manifest: one, cacheDir: cache, sources: { [urlOf(0)]: local }, fetch: noFetch() })
            await c3.ensure()
            assert.strictEqual(c3.stats().sourced, 1)
            assert.deepStrictEqual(fs.readFileSync(fpCache), body)
        })

        it('[CS06] 同內容(sha256 相同)之多個網址只要有一個有本機來源即不下載: 兩網址皆就緒、sourced 為 1(以內容計)', async function() {
            let body = fx.bodies['/pkg-0@1.0.0/dist/f0.js']
            let a = HOST + '/a/same.js'
            let b = HOST + '/b/same.js'
            let ent = { sha256: sha(body), size: body.length }
            let f = noFetch()
            let cdn = createCdnLocal({ manifest: { schema: 1, files: { [a]: ent, [b]: ent } }, cacheDir: dirOf('sib'), sources: { [b]: srcOf(0) }, fetch: f })
            await cdn.ensure()
            assert.deepStrictEqual(f.calls, [])
            assert.deepStrictEqual([cdn.stats().files, cdn.stats().contents, cdn.stats().sourced], [2, 1, 1])
            assert.deepStrictEqual(fs.readFileSync(cdn.fileOf(a)), body)
            assert.strictEqual(cdn.fileOf(a), cdn.fileOf(b))
        })

        it('[CS06b] 同內容有多個本機來源: 全部都須與清單相符, 任一不符即拒收(不因宣告順序或清單順序而擇一, 結果與順序無關), 且不留任何快取內容; 全部相符則只補入 1 次', async function() {
            let body = fx.bodies['/pkg-0@1.0.0/dist/f0.js']
            let bad = Buffer.from(body)
            bad[0] ^= 0x01
            let fpBad = path.join(fdSrc, 'dup-bad.js')
            fs.writeFileSync(fpBad, bad)
            let a = HOST + '/a/same.js'
            let b = HOST + '/b/same.js'
            let ent = { sha256: sha(body), size: body.length }
            let mkc = (files, sources) => createCdnLocal({ manifest: { schema: 1, files }, cacheDir: dirOf('dup'), sources, fetch: noFetch() })

            //清單順序(a、b 或 b、a)× 壞來源屬 a 或 b: 四種組合皆須失敗, 且指明壞的那一個
            for (let [files, sources, badUrl] of [
                [{ [a]: ent, [b]: ent }, { [a]: srcOf(0), [b]: fpBad }, b],
                [{ [a]: ent, [b]: ent }, { [a]: fpBad, [b]: srcOf(0) }, a],
                [{ [b]: ent, [a]: ent }, { [a]: srcOf(0), [b]: fpBad }, b],
                [{ [b]: ent, [a]: ent }, { [a]: fpBad, [b]: srcOf(0) }, a],
            ]) {
                let cdn = mkc(files, sources)
                let err = await cdn.ensure().then(() => null, (e) => e)
                assert.ok(err, '壞來源不得被略過: ' + badUrl)
                assert.strictEqual(err.code, 'E_CDN_SOURCE')
                assert.strictEqual(err.reason, 'sha256-mismatch')
                assert.strictEqual(err.cdnUrl, badUrl)
                assert.strictEqual(fs.existsSync(path.join(cdn.cacheDir, ent.sha256)), false, '任一來源不符即不補入')
                assert.deepStrictEqual(partsOf(cdn.cacheDir), [])
            }

            //其中一個缺檔: 同樣拒收
            let miss = mkc({ [a]: ent, [b]: ent }, { [a]: srcOf(0), [b]: path.join(fdSrc, 'dup-nope.js') })
            let me = await miss.ensure().then(() => null, (e) => e)
            assert.deepStrictEqual([me && me.code, me && me.reason, me && me.cdnUrl], ['E_CDN_SOURCE', 'missing', b])

            //全部相符: 只補入 1 次(以內容計)
            let ok = mkc({ [a]: ent, [b]: ent }, { [a]: srcOf(0), [b]: srcOf(0) })
            await ok.ensure()
            assert.deepStrictEqual([ok.stats().contents, ok.stats().sourced], [1, 1])
        })

        it('[CS07] 離線: 全部有本機來源時照常補齊(不連網、不需網路); 仍有須連網者拋 E_CDN_OFFLINE_MISSING, err.missing 只列須連網者', async function() {
            let sources = {}
            for (let i = 0; i < 6; i++) {
                sources[urlOf(i)] = srcOf(i)
            }
            let f = noFetch()
            let ok = createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('off'), offline: true, sources, fetch: f })
            await ok.ensure()
            assert.deepStrictEqual([ok.stats().ready, ok.stats().sourced, ok.stats().offline, f.calls.length], [true, 6, true, 0])

            let cache = dirOf('offmix')
            let part = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, offline: true, sources: { [urlOf(0)]: srcOf(0), [urlOf(1)]: srcOf(1) }, fetch: f })
            let err = await part.ensure().then(() => null, (e) => e)
            assert.strictEqual(err.code, 'E_CDN_OFFLINE_MISSING')
            assert.deepStrictEqual(err.missing.map((m) => m.url).sort(), [2, 3, 4, 5].map(urlOf).sort(), 'missing 只列須連網者')
            assert.ok(!err.message.includes(cache))
            assert.deepStrictEqual(f.calls, [])
        })

    })


    describe('opt.stubs 空腳本(R-CL-13)', function() {

        it('[CS08] 給了而無效即拋 E_CDN_ARG(帶索引): 非陣列、元素非網址字串或 { url, type }、url 非 http(s)、type 非可見 ASCII; 與清單矛盾(清單內非空檔、type 不同)亦拋; 清單內已是空檔者、重複同內容者接受', function() {
            let mk = (stubs, manifest = fx.manifest) => createCdnLocal({ manifest, cacheDir: dirOf('stubarg'), stubs })
            for (let bad of ['x', 5, {}, true]) {
                assert.throws(() => mk(bad), (err) => err.code === 'E_CDN_ARG' && /opt\.stubs/.test(err.message), String(bad))
            }
            let u = HOST + '/unpinned.js'
            for (let el of [5, null, [], {}, { url: 5 }, { url: u, type: 5 }, { url: u, type: '' }, { url: u, type: 'a\r\nb' }, 'not a url', 'ftp://x/a.js', 'https://x/a b.js', 'https://x/a.js#h', '']) {
                assert.throws(() => mk([u, el]), (err) => err.code === 'E_CDN_ARG' && /opt\.stubs\[1\]/.test(err.message), JSON.stringify(el))
            }
            //與清單矛盾: 該網址在清單內但不是空檔
            assert.throws(() => mk([urlOf(0)]), (err) => err.code === 'E_CDN_ARG' && /opt\.stubs\[0\].*矛盾/.test(err.message))
            //清單內已是空檔: 接受(併入, 不重複計檔); type 不同則矛盾
            let m = { schema: 1, files: { [u]: { sha256: EMPTY, size: 0, type: 'text/css' } } }
            assert.doesNotThrow(() => mk([u], m))
            assert.doesNotThrow(() => mk([{ url: u, type: 'text/css' }], m))
            assert.throws(() => mk([{ url: u, type: 'text/plain' }], m), (err) => err.code === 'E_CDN_ARG' && /矛盾/.test(err.message))
            assert.strictEqual(mk([u], m).stats().files, 1)
            assert.strictEqual(mk([u], m).stats().stubs, 1)
            //同網址重複(同內容): 接受; type 不同則矛盾
            assert.doesNotThrow(() => mk([u, u, 'https://CDN.FIXTURE.INVALID:443/unpinned.js']))
            assert.strictEqual(mk([u, u, 'https://CDN.FIXTURE.INVALID:443/unpinned.js']).stats().files, 7, '正規化後相同者併為一項(清單 6 ＋ 空腳本 1)')
            assert.throws(() => mk([{ url: u, type: 'text/css' }, { url: u, type: 'text/plain' }]), (err) => err.code === 'E_CDN_ARG' && /opt\.stubs\[1\]/.test(err.message))
            //稀疏陣列之空洞視為無效元素(不被略過)
            let sparseStubs = [u, 'x', u + '2']
            delete sparseStubs[1] //造出空洞(以 delete 而非字面逗號, 免 no-sparse-arrays)
            assert.throws(() => mk(sparseStubs), (err) => err.code === 'E_CDN_ARG' && /opt\.stubs\[1\]/.test(err.message))
            //清單項目未給 type 而空腳本給了: 採用宣告之 type(不靜默丟棄); 清單與空腳本皆給且相同者保留
            let noType = { schema: 1, files: { [u]: { sha256: EMPTY, size: 0 } } }
            assert.strictEqual(mk([{ url: u, type: 'text/css' }], noType).lookup(u).type, 'text/css')
            assert.strictEqual(mk([u], noType).lookup(u).type, undefined, '空腳本未給 type 則維持清單之原樣')
            assert.strictEqual(mk([{ url: u, type: 'text/css' }], m).lookup(u).type, 'text/css')
            //未給、null、空陣列: 視為未給
            for (let ok of [undefined, null, []]) {
                assert.strictEqual(mk(ok).stats().stubs, 0)
            }
        })

        it('[CS09] 空腳本併入有效清單: 以 0 位元組供應(content-type 依副檔名或 type), 不連網; stats().files／stubs 計入; 空內容之快取檔為內容定址之空檔; 路由與 Node 端 fetch 皆回空內容; 離線亦可; 未列者仍為清單外', async function() {
            let srv = await startServer(fx.bodies)
            try {
                let cache = dirOf('stub')
                let js = HOST + '/unpinned/lib.js'
                let css = HOST + '/css2?family=X'
                let mod = HOST + '/unpinned/mod'
                let cdn = createCdnLocal({ manifest: fx.manifest, cacheDir: cache, stubs: [js, { url: css, type: 'text/css; charset=utf-8' }, { url: mod, type: 'application/javascript' }], fetch: srv.fetch, retryDelayMs: 10 })
                await cdn.ensure()
                let st = cdn.stats()
                assert.deepStrictEqual([st.files, st.contents, st.stubs, st.sourced, st.downloaded], [9, 7, 3, 1, 6], '清單 6 + 空腳本 3 網址; 空內容為 1 個內容(sourced 以內容計)')
                assert.deepStrictEqual(Object.keys(srv.hits).length, 6, '只有清單內 6 檔被下載, 空腳本不連網')
                assert.strictEqual(fs.statSync(path.join(cache, EMPTY)).size, 0)
                assert.deepStrictEqual(cdn.lookup(js), { sha256: EMPTY, size: 0 })
                assert.deepStrictEqual(cdn.lookup(css), { sha256: EMPTY, size: 0, type: 'text/css; charset=utf-8' })

                let ctx = mkCtx()
                await cdn.routeBrowser(ctx)
                let types = {}
                for (let u of [js, css, mod]) {
                    let r = mkRoute(u)
                    await ctx.routes[0][1](r)
                    let [kind, o] = r.calls[0]
                    assert.strictEqual(kind, 'fulfill')
                    assert.strictEqual(o.status, 200)
                    assert.strictEqual(o.body.length, 0)
                    assert.strictEqual(o.headers['access-control-allow-origin'], '*')
                    types[u] = o.headers['content-type']
                }
                assert.deepStrictEqual(types, { [js]: 'application/javascript; charset=utf-8', [css]: 'text/css; charset=utf-8', [mod]: 'application/javascript' })

                let restore = cdn.patchFetch()
                try {
                    let res = await fetch(js)
                    assert.strictEqual(res.status, 200)
                    assert.strictEqual((await res.arrayBuffer()).byteLength, 0)
                    await assert.rejects(() => fetch(HOST + '/unpinned/other.js'), (err) => err.code === 'E_CDN_EXTERNAL', '未列之網址仍為清單外')
                }
                finally {
                    restore()
                }
                assert.strictEqual(cdn.getViolations().length, 1)

                //離線、清單為空: 空腳本照常就緒(不需網路)
                let f = noFetch()
                let off = createCdnLocal({ manifest: { schema: 1, files: {} }, cacheDir: dirOf('stuboff'), offline: true, stubs: [js], fetch: f })
                await off.ensure()
                assert.deepStrictEqual([off.stats().ready, off.stats().sourced, off.stats().stubs, f.calls.length], [true, 1, 1, 0])
                assert.ok(off.lookup(js))
            }
            finally {
                await srv.close()
            }
        })

    })


    describe('opt.loopbackPorts 只放行指定回送埠(R-CL-15)', function() {
        let mk = (opt = {}) => createCdnLocal({ manifest: fx.manifest, cacheDir: dirOf('lb'), ...opt })

        it('[CS10] 給了而無效即拋 E_CDN_ARG: 非陣列、元素非 1 至 65535 之整數(含字串、小數、0、65536、NaN、BigInt); 明確 allowLoopback:false 又給非空 loopbackPorts 為矛盾亦拋; false 加空陣列、true 加埠、未給／null 皆可', function() {
            for (let bad of ['3000', 3000, {}, true]) {
                assert.throws(() => mk({ loopbackPorts: bad }), (err) => err.code === 'E_CDN_ARG' && /opt\.loopbackPorts/.test(err.message), String(bad))
            }
            for (let p of ['80', 80.5, 0, -1, 65536, NaN, Infinity, 1n, null, undefined, [80]]) {
                assert.throws(() => mk({ loopbackPorts: [3000, p] }), (err) => err.code === 'E_CDN_ARG' && /opt\.loopbackPorts/.test(err.message), String(p))
            }
            let sparsePorts = [3000, 1, 3001]
            delete sparsePorts[1]
            assert.throws(() => mk({ loopbackPorts: sparsePorts }), (err) => err.code === 'E_CDN_ARG' && /opt\.loopbackPorts/.test(err.message), '稀疏陣列之空洞視為無效元素')
            assert.throws(() => mk({ allowLoopback: false, loopbackPorts: [3000] }), (err) => err.code === 'E_CDN_ARG' && /矛盾/.test(err.message))
            assert.doesNotThrow(() => mk({ allowLoopback: false, loopbackPorts: [] }))
            assert.doesNotThrow(() => mk({ allowLoopback: true, loopbackPorts: [3000] }))
            assert.doesNotThrow(() => mk({ loopbackPorts: [1, 65535, 3000, 3000] }))
            assert.doesNotThrow(() => mk({ loopbackPorts: null }))
            assert.doesNotThrow(() => mk({ loopbackPorts: undefined }))
            //非布林之 allowLoopback 視為未給(K3): 與 loopbackPorts 不矛盾
            assert.doesNotThrow(() => mk({ allowLoopback: 'false', loopbackPorts: [3000] }))
        })

        //以路由處理器之分支驗放行與否: fallback＝放行, abort＝外部請求(並記違規)
        let verdict = async (cdn, u) => {
            let ctx = mkCtx()
            await cdn.routeBrowser(ctx)
            let r = mkRoute(u, mkReq(u))
            await ctx.routes[0][1](r)
            return r.calls[0][0]
        }

        it('[CS11] 只放行 loopbackPorts 內之回送埠(HTTP): 列入之埠放行(localhost、127.x、[::1]、*.localhost 皆可), 其餘回送位址之埠視為外部(中止並記違規); 未寫埠依協定之預設埠(80、443); 非回送位址不受影響', async function() {
            let cdn = mk({ loopbackPorts: [3000, 80] })
            assert.strictEqual(await verdict(cdn, 'http://127.0.0.1:3000/a'), 'fallback')
            assert.strictEqual(await verdict(cdn, 'http://localhost:3000/a'), 'fallback')
            assert.strictEqual(await verdict(cdn, 'http://[::1]:3000/a'), 'fallback')
            assert.strictEqual(await verdict(cdn, 'http://app.localhost:3000/a'), 'fallback')
            assert.strictEqual(await verdict(cdn, 'http://127.0.0.1:3001/a'), 'abort', '未列入之埠')
            assert.strictEqual(await verdict(cdn, 'http://127.0.0.1:30000/a'), 'abort', '埠不以前綴比對')
            assert.strictEqual(await verdict(cdn, 'http://127.0.0.1/a'), 'fallback', 'http 預設埠 80 已列入')
            assert.strictEqual(await verdict(cdn, 'https://127.0.0.1/a'), 'abort', 'https 預設埠 443 未列入')
            assert.strictEqual(await verdict(cdn, 'http://127.0.0.1:80/a'), 'fallback', '明寫預設埠與省略等價')
            assert.strictEqual(await verdict(cdn, 'https://example.invalid:3000/a'), 'abort', '非回送位址即使埠相同亦為外部')
            assert.strictEqual(await verdict(cdn, 'http://127.0.0.1.invalid:3000/a'), 'abort', '前綴相似之外部主機')
            assert.strictEqual(cdn.getViolations().length, 5, '中止者各記一筆(3001、30000、https 預設埠 443、非回送位址、前綴相似之外部主機)')

            //預設埠: 443 列入時 https 放行
            let c443 = mk({ loopbackPorts: [443] })
            assert.strictEqual(await verdict(c443, 'https://127.0.0.1/a'), 'fallback')
            assert.strictEqual(await verdict(c443, 'http://127.0.0.1/a'), 'abort')
        })

        it('[CS12] 優先序: 給了 loopbackPorts 者以它為準(allowLoopback 預設之「全放行」不再適用); [] 即不放行任何回送位址; allow 明列者仍可再放行(與 loopbackPorts 取聯集); 清單內之網址仍優先由本地副本回應; 未給 loopbackPorts 者行為不變(allowLoopback 全有或全無)', async function() {
            //[]: 任何回送位址皆為外部
            let none = mk({ loopbackPorts: [] })
            assert.strictEqual(await verdict(none, 'http://127.0.0.1:3000/a'), 'abort')
            //allowLoopback:true 加埠: 仍只放行該埠(明確給 true 不改變 loopbackPorts 之限縮)
            let both = mk({ allowLoopback: true, loopbackPorts: [3000] })
            assert.strictEqual(await verdict(both, 'http://127.0.0.1:3000/a'), 'fallback')
            assert.strictEqual(await verdict(both, 'http://127.0.0.1:3001/a'), 'abort')
            //allow 另放行(聯集)
            let withAllow = mk({ loopbackPorts: [3000], allow: [/^http:\/\/127\.0\.0\.1:3001\//] })
            assert.strictEqual(await verdict(withAllow, 'http://127.0.0.1:3000/a'), 'fallback')
            assert.strictEqual(await verdict(withAllow, 'http://127.0.0.1:3001/a'), 'fallback')
            assert.strictEqual(await verdict(withAllow, 'http://127.0.0.1:3002/a'), 'abort')
            //未給 loopbackPorts: 既有行為(allowLoopback 預設 true 全放行; false 全不放行)
            assert.strictEqual(await verdict(mk(), 'http://127.0.0.1:3999/a'), 'fallback')
            assert.strictEqual(await verdict(mk({ allowLoopback: false }), 'http://127.0.0.1:3999/a'), 'abort')

            //清單內優先: 清單列了未放行埠之回送網址, 仍由本地副本回應
            let body = Buffer.from('loop-served')
            let u = 'http://127.0.0.1:3777/lib.js'
            let cdn = createCdnLocal({ manifest: { schema: 1, files: { [u]: { sha256: sha(body), size: body.length } } }, cacheDir: dirOf('lbmf'), fetch: async () => new Response(body), retryDelayMs: 10, loopbackPorts: [3000] })
            await cdn.ensure()
            assert.strictEqual(await verdict(cdn, u), 'fulfill')
            assert.strictEqual(cdn.getViolations().length, 0)
        })

        it('[CS13] Node 端 fetch 與 ws(s) 同一判定: 列入之埠原樣放行(走原 fetch)、未列入之回送位址拋 E_CDN_EXTERNAL 並記違規; ws 之放行判定函數同一邏輯(只攔未列入之埠)', async function() {
            let srv = await startServer({ '/local.txt': Buffer.from('loopback-ok') })
            let other = await startServer({ '/local.txt': Buffer.from('other-port') })
            try {
                let port = Number(new URL(srv.baseUrl).port)
                let cdn = mk({ loopbackPorts: [port] })
                let restore = cdn.patchFetch()
                try {
                    let res = await fetch(srv.baseUrl + '/local.txt')
                    assert.strictEqual(await res.text(), 'loopback-ok')
                    await assert.rejects(() => fetch(other.baseUrl + '/local.txt'), (err) => err.code === 'E_CDN_EXTERNAL' && err.violations[0].kind === 'fetch')
                    assert.strictEqual(other.hits['/local.txt'], undefined, '未列入之埠不得連線')
                }
                finally {
                    restore()
                }

                //ws: 以 routeWebSocket 之判定函數(matcher 為真＝攔截)驗: 只攔未列入之埠
                let ctx = mkCtx()
                await cdn.routeBrowser(ctx)
                let matcher = ctx.wsRoutes[0][0]
                assert.strictEqual(matcher(new URL(`ws://127.0.0.1:${port}/socket`)), false, '列入之埠不攔')
                assert.strictEqual(matcher(new URL(`ws://127.0.0.1:${port + 1}/socket`)), true, '未列入之埠攔截')
                assert.strictEqual(matcher(new URL('wss://example.invalid/socket')), true)
                assert.strictEqual(matcher(new URL('ws://127.0.0.1/socket')), true, 'ws 預設埠 80 未列入')
            }
            finally {
                await srv.close()
                await other.close()
            }
        })

    })

})
