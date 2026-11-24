import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import genCdnManifest, { diffCdnManifest } from '../src/genCdnManifest.mjs'
import createCdnLocal from '../src/createCdnLocal.mjs'
import loadCdnManifest from '../src/loadCdnManifest.mjs'
import { HOST, sha, startServer } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md R-CL-7(清單之產生: 相對匯入閉包、下載重試、絕對網址不靜默略過、差異比對)
//  夾具伺服器經 opt.fetch 接上「外部網址」(https://cdn.fixture.invalid), 不連外網; 命令列版見 api-genCdnManifest.test.mjs

let fdTmp = fileURLToPath(new URL('./_tmp/genCdnManifest/', import.meta.url))

let B = (s) => Buffer.from(s)

//夾具: ESM 閉包(靜態、動態、export from、副作用匯入、上層目錄、迴圈)、CSS(@import、url()、片段、data:、註解)、經典腳本(內含 import 字樣但不解析)
let makeSite = () => ({
    '/m/main.mjs': B('import { a } from \'./chunk/a.mjs\'\nconst b = () => import("./chunk/b.mjs")\nexport * from \'../up/c.mjs\'\nimport \'./side.mjs\'\nimport lodash from \'lodash\'\nexport { a, b, lodash }\n'),
    '/m/chunk/a.mjs': B('import { b2 } from \'./b.mjs\'\nexport const a = 1\n'),
    '/m/chunk/b.mjs': B('import { a } from \'./a.mjs\'\nexport const b2 = a\n'), //與 a.mjs 互相匯入(迴圈)
    '/up/c.mjs': B('export const c = 3\n'),
    '/m/side.mjs': B('console.log(\'side\')\n'),
    '/m/style.css': B('@import "./base.css";\n/* url(./commented.png) */\n.a{background:url(./img/x.png?v=1#frag)}\n.b{background:url("data:image/png;base64,AAAA")}\n.c{src:url(\'/fonts/f.woff2\')}\n@import url(./more.css);\n'),
    '/m/base.css': B('.base{color:red}\n'),
    '/m/more.css': B('.more{color:blue}\n'),
    '/m/img/x.png?v=1': B('PNG-x'),
    '/fonts/f.woff2': B('WOFF2-f'),
    '/lib/umd.js': B('/* UMD */ import \'./not-followed.mjs\'\n'), //非 .mjs, 不解析
})

let srvOf = async (site) => {
    let srv = await startServer(site)
    return { ...srv, urls: (ps) => ps.map((p) => HOST + p) }
}


describe('unit-genCdnManifest', function() {

    before(function() {
        fs.mkdirSync(fdTmp, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('[GM01] ESM 閉包: 靜態 from、動態 import()、export from、副作用匯入、上層目錄與迴圈皆納入, 每檔只下載一次, 裸指定詞(lodash)不處理; sha256 與大小正確', async function() {
        let site = makeSite()
        let srv = await srvOf(site)
        try {
            let m = await genCdnManifest({ roots: { main: HOST + '/m/main.mjs' }, fetch: srv.fetch, retryDelayMs: 1 })
            assert.deepStrictEqual(Object.keys(m.files), srv.urls(['/m/chunk/a.mjs', '/m/chunk/b.mjs', '/m/main.mjs', '/m/side.mjs', '/up/c.mjs']), '依網址排序且恰為閉包')
            assert.deepStrictEqual(m.roots, { main: HOST + '/m/main.mjs' })
            for (let [p, b] of Object.entries(site)) {
                if (m.files[HOST + p]) {
                    assert.deepStrictEqual(m.files[HOST + p], { sha256: sha(b), size: b.length }, p)
                }
            }
            for (let p of ['/m/main.mjs', '/m/chunk/a.mjs', '/m/chunk/b.mjs', '/up/c.mjs', '/m/side.mjs']) {
                assert.strictEqual(srv.hits[p], 1, p + ' 只應請求 1 次(含迴圈)')
            }
            assert.strictEqual(m.schema, 1)
            assert.ok(/釘選值/.test(m.note))
            assert.deepStrictEqual(loadCdnManifest(m), m, '產生之清單通過 loadCdnManifest 且已正規化')
        }
        finally {
            await srv.close()
        }
    })

    it('[GM02] CSS 閉包: @import(含 url() 形)與 url() 之相對指定詞納入(查詢保留、片段去除、根相對路徑解析), 略過 data: 與註解中者', async function() {
        let site = makeSite()
        let srv = await srvOf(site)
        try {
            let m = await genCdnManifest({ roots: [HOST + '/m/style.css'], fetch: srv.fetch, retryDelayMs: 1 })
            assert.deepStrictEqual(Object.keys(m.files), srv.urls(['/fonts/f.woff2', '/m/base.css', '/m/img/x.png?v=1', '/m/more.css', '/m/style.css']))
            assert.deepStrictEqual(m.roots, { [HOST + '/m/style.css']: HOST + '/m/style.css' }, '陣列形之根: 鍵取網址本身')
            assert.strictEqual(srv.hits['/m/commented.png'], undefined, '註解內之 url() 不下載')
        }
        finally {
            await srv.close()
        }
    })

    it('[GM03] 經典(UMD)之 .js 不解析其內之 import 字樣; opt.esm 可指定其他副檔名視為 ESM', async function() {
        let site = makeSite()
        site['/lib/not-followed.mjs'] = B('export default 1\n')
        let srv = await srvOf(site)
        try {
            let m = await genCdnManifest({ roots: { umd: HOST + '/lib/umd.js' }, fetch: srv.fetch, retryDelayMs: 1 })
            assert.deepStrictEqual(Object.keys(m.files), srv.urls(['/lib/umd.js']))
            assert.strictEqual(srv.hits['/lib/not-followed.mjs'], undefined)
            let m2 = await genCdnManifest({ roots: { umd: HOST + '/lib/umd.js' }, fetch: srv.fetch, retryDelayMs: 1, esm: /\.js$/ })
            assert.deepStrictEqual(Object.keys(m2.files), srv.urls(['/lib/not-followed.mjs', '/lib/umd.js']))
            let m3 = await genCdnManifest({ roots: { umd: HOST + '/lib/umd.js' }, fetch: srv.fetch, retryDelayMs: 1, esm: 'bad' })
            assert.deepStrictEqual(Object.keys(m3.files), srv.urls(['/lib/umd.js']), 'opt.esm 非 RegExp 視為未給')
        }
        finally {
            await srv.close()
        }
    })

    it('[GM04] 絕對網址之匯入不靜默略過: 未列入 roots 者拋 E_CDN_GEN(列出網址); 已在 roots 或閉包內者通過; 片段去除', async function() {
        let site = {
            '/x/a.mjs': B(`import 'https://cdn.fixture.invalid/y/abs.mjs'\nimport 'https://cdn.fixture.invalid/y/abs2.mjs#h'\n`),
            '/y/abs.mjs': B('export const abs = 1\n'),
            '/y/abs2.mjs': B('export const abs2 = 1\n'),
            '/x/c.css': B('.a{background:url(https://cdn.fixture.invalid/y/img.png)}\n'),
            '/y/img.png': B('PNG'),
        }
        let srv = await srvOf(site)
        try {
            let err = await genCdnManifest({ roots: { a: HOST + '/x/a.mjs' }, fetch: srv.fetch, retryDelayMs: 1 }).catch((e) => e)
            assert.strictEqual(err.code, 'E_CDN_GEN')
            assert.ok(/abs\.mjs/.test(err.message) && /abs2\.mjs/.test(err.message) && !/#h/.test(err.message), err.message)
            let err2 = await genCdnManifest({ roots: { c: HOST + '/x/c.css' }, fetch: srv.fetch, retryDelayMs: 1 }).catch((e) => e)
            assert.strictEqual(err2.code, 'E_CDN_GEN', 'CSS 之絕對網址亦然')
            let m = await genCdnManifest({ roots: { a: HOST + '/x/a.mjs', b: HOST + '/y/abs.mjs', c: HOST + '/y/abs2.mjs' }, fetch: srv.fetch, retryDelayMs: 1 })
            assert.deepStrictEqual(Object.keys(m.files), srv.urls(['/x/a.mjs', '/y/abs.mjs', '/y/abs2.mjs']))
        }
        finally {
            await srv.close()
        }
    })

    it('[GM04b] 協定相對網址(//host/x)同絕對網址: 不自動納入、未列入 roots 者拋 E_CDN_GEN(CSS 與 ESM 皆然); 已列入者通過; 無法解析之指定詞略過', async function() {
        let site = {
            '/p/a.mjs': B('import \'//cdn.fixture.invalid/q/rel.mjs\'\nimport \'https://\'\n'),
            '/q/rel.mjs': B('export const r = 1\n'),
            '/p/c.css': B('@import url(//cdn.fixture.invalid/q/rel.css);\n.a{background:url(//cdn.fixture.invalid/q/rel.png)}\n'),
            '/q/rel.css': B('.r{}\n'),
            '/q/rel.png': B('PNG'),
        }
        let srv = await srvOf(site)
        try {
            let e1 = await genCdnManifest({ roots: { a: HOST + '/p/a.mjs' }, fetch: srv.fetch, retryDelayMs: 1 }).catch((e) => e)
            assert.strictEqual(e1.code, 'E_CDN_GEN', 'ESM 之協定相對匯入不得靜默略過')
            assert.ok(/q\/rel\.mjs/.test(e1.message), e1.message)
            let e2 = await genCdnManifest({ roots: { c: HOST + '/p/c.css' }, fetch: srv.fetch, retryDelayMs: 1 }).catch((e) => e)
            assert.strictEqual(e2.code, 'E_CDN_GEN', 'CSS 之協定相對引用不得靜默略過')
            assert.ok(/rel\.css/.test(e2.message) && /rel\.png/.test(e2.message), e2.message)
            let m = await genCdnManifest({ roots: { a: HOST + '/p/a.mjs', r: HOST + '/q/rel.mjs' }, fetch: srv.fetch, retryDelayMs: 1 })
            assert.deepStrictEqual(Object.keys(m.files), srv.urls(['/p/a.mjs', '/q/rel.mjs']))

            //roots 之寫法與匯入之正規化形式不同(主機大小寫、預設埠)者，仍視為已列入
            let m2 = await genCdnManifest({ roots: { a: HOST + '/p/a.mjs', r: 'https://CDN.FIXTURE.INVALID:443/q/rel.mjs' }, fetch: (u, i) => srv.fetch(new URL(u).href, i), retryDelayMs: 1 })
            assert.strictEqual(Object.keys(m2.files).length, 2)
        }
        finally {
            await srv.close()
        }
    })

    it('[GM04c] 副檔名無法判定內容類型之網址(無副檔名、僅有查詢)另記伺服器回應之 content-type(type 欄); 副檔名可判定者不記; 無效之 content-type 不記', async function() {
        let site = {
            '/css2?family=Roboto': { body: B('.a{}\n'), type: 'text/css; charset=utf-8' },
            '/sub.css': B('.sub{}\n'), //伺服器回報 application/javascript, 但副檔名已可判定
            '/mod': { body: B('export const m = 1\n'), type: 'application/javascript' },
            '/weird': { body: B('x'), type: 'text/plainé' },
        }
        let srv = await srvOf(site)
        try {
            let m = await genCdnManifest({ roots: { css: HOST + '/css2?family=Roboto', sub: HOST + '/sub.css', mod: HOST + '/mod', weird: HOST + '/weird' }, fetch: srv.fetch, retryDelayMs: 1 })
            assert.strictEqual(m.files[HOST + '/css2?family=Roboto'].type, 'text/css; charset=utf-8')
            assert.strictEqual(m.files[HOST + '/mod'].type, 'application/javascript')
            assert.ok(!('type' in m.files[HOST + '/weird']), '非可見 ASCII 之 content-type 不記')
            assert.ok(!('type' in m.files[HOST + '/sub.css']), '副檔名可判定者不記(即使伺服器回報 application/javascript)')
        }
        finally {
            await srv.close()
        }
    })

    it('[GM05] 下載重試: 暫時性失敗(500)重試後成功; 逾 maxAttempts 仍失敗拋 E_CDN_GEN(含網址、不回顯查詢秘密值); 閉包內之檔 404 亦拋錯', async function() {
        let site = makeSite()
        let srv = await srvOf(site)
        try {
            let calls = {}
            let flaky = async (u, init) => {
                calls[u] = (calls[u] || 0) + 1
                if (u.endsWith('/up/c.mjs') && calls[u] < 3) {
                    return new Response('', { status: 500 })
                }
                return srv.fetch(u, init)
            }
            let m = await genCdnManifest({ roots: { main: HOST + '/m/main.mjs' }, fetch: flaky, retryDelayMs: 1 })
            assert.ok(m.files[HOST + '/up/c.mjs'])
            assert.strictEqual(calls[HOST + '/up/c.mjs'], 3, '第 3 次成功')

            let always = async () => new Response('', { status: 503 })
            let n = 0
            let err = await genCdnManifest({
                roots: { a: HOST + '/a.js?token=SECRET99' },
                fetch: async (u) => {
                    n++
                    return always(u)
                },
                maxAttempts: 2,
                retryDelayMs: 1
            }).catch((e) => e)
            assert.strictEqual(err.code, 'E_CDN_GEN')
            assert.strictEqual(n, 2, '依 maxAttempts 嘗試')
            assert.ok(/a\.js/.test(err.message) && !/SECRET99/.test(err.message + String(err.url)), err.message)

            site['/m/chunk/a.mjs'] = undefined //閉包內之檔不存在
            let err3 = await genCdnManifest({ roots: { main: HOST + '/m/main.mjs' }, fetch: srv.fetch, retryDelayMs: 1, maxAttempts: 1 }).catch((e) => e)
            assert.strictEqual(err3.code, 'E_CDN_GEN')
            assert.ok(/chunk\/a\.mjs/.test(err3.message))
        }
        finally {
            await srv.close()
        }
    })

    it('[GM06] 參數: roots 須為非空物件或網址陣列, 網址須為 http(s) 且不含空白與 #; 其餘 opt 非預期之輸入視為未給', async function() {
        let site = makeSite()
        let srv = await srvOf(site)
        try {
            for (let bad of [undefined, null, {}, [], 'x', 5, { a: 'ftp://x/a.js' }, { a: 'https://x/a b.js' }, { a: 'https://x/a.js#f' }, { a: 5 }, ['not-url']]) {
                await assert.rejects(() => genCdnManifest({ roots: bad, fetch: srv.fetch }), (e) => e.code === 'E_CDN_GEN', JSON.stringify(bad))
            }
            await assert.rejects(() => genCdnManifest(), (e) => e.code === 'E_CDN_GEN')
            let m = await genCdnManifest({ roots: { x: HOST + '/m/side.mjs' }, fetch: srv.fetch, maxAttempts: 'x', retryDelayMs: -1, concurrency: 99, note: 5 })
            assert.deepStrictEqual(Object.keys(m.files), srv.urls(['/m/side.mjs']))
            let m2 = await genCdnManifest({ roots: { x: HOST + '/m/side.mjs' }, fetch: srv.fetch, note: '自訂說明' })
            assert.strictEqual(m2.note, '自訂說明')
        }
        finally {
            await srv.close()
        }
    })

    it('[GM07] 並行下載: 閉包之各檔仍每檔只請求 1 次(concurrency 1 與 8 結果相同)', async function() {
        let site = makeSite()
        let srv = await srvOf(site)
        try {
            let a = await genCdnManifest({ roots: { main: HOST + '/m/main.mjs', css: HOST + '/m/style.css' }, fetch: srv.fetch, concurrency: 1 })
            let b = await genCdnManifest({ roots: { main: HOST + '/m/main.mjs', css: HOST + '/m/style.css' }, fetch: srv.fetch, concurrency: 8 })
            assert.deepStrictEqual(a, b)
            assert.strictEqual(Object.keys(a.files).length, 10)
            for (let n of Object.values(srv.hits)) {
                assert.strictEqual(n, 2, '兩次產生各請求 1 次')
            }
        }
        finally {
            await srv.close()
        }
    })

    it('[GM08] diffCdnManifest: added／removed／changed／roots(不計順序); 無差異回空陣列; 輸入先檢核', function() {
        let f = (c, s = 1) => ({ sha256: c.repeat(64), size: s })
        let a = { schema: 1, roots: { x: 'https://h/a.js', y: 'https://h/b.js' }, files: { 'https://h/a.js': f('a'), 'https://h/b.js': f('b'), 'https://h/c.js': f('c') } }
        let b = { schema: 1, roots: { y: 'https://h/b.js', x: 'https://h/a.js' }, files: { 'https://h/a.js': f('a'), 'https://h/b.js': f('d'), 'https://h/e.js': f('e') } }
        assert.deepStrictEqual(diffCdnManifest(a, a), [])
        assert.deepStrictEqual(diffCdnManifest(a, b), [
            { type: 'changed', url: 'https://h/b.js' },
            { type: 'removed', url: 'https://h/c.js' },
            { type: 'added', url: 'https://h/e.js' },
        ], 'roots 只是順序不同, 不列')
        let c = { ...a, roots: { x: 'https://h/other.js', y: 'https://h/b.js' } }
        assert.deepStrictEqual(diffCdnManifest(a, c), [{ type: 'roots' }])
        let d = { ...a, files: { ...a.files, 'https://h/a.js': f('a', 2) } }
        assert.deepStrictEqual(diffCdnManifest(a, d), [{ type: 'changed', url: 'https://h/a.js' }], '大小不同亦算內容不同')
        let t = { ...a, files: { ...a.files, 'https://h/a.js': { ...f('a'), type: 'text/css' } } }
        assert.deepStrictEqual(diffCdnManifest(a, t), [{ type: 'changed', url: 'https://h/a.js' }], 'type 不同亦算不同')
        assert.deepStrictEqual(diffCdnManifest(t, t), [])
        assert.throws(() => diffCdnManifest(a, { schema: 9 }), (e) => e.code === 'E_CDN_MANIFEST')
    })

    it('[GM09] 整合: 產生之清單交給 createCdnLocal 取得, 快取內容之 sha256 與清單相同(端到端)', async function() {
        let site = makeSite()
        let srv = await srvOf(site)
        try {
            let m = await genCdnManifest({ roots: { main: HOST + '/m/main.mjs', css: HOST + '/m/style.css' }, fetch: srv.fetch, retryDelayMs: 1 })
            let cdn = createCdnLocal({ manifest: m, cacheDir: path.join(fdTmp, 'integration'), fetch: srv.fetch, retryDelayMs: 10 })
            await cdn.ensure()
            for (let [url, e] of Object.entries(m.files)) {
                assert.strictEqual(sha(fs.readFileSync(cdn.fileOf(url))), e.sha256, url)
            }
            assert.strictEqual(cdn.stats().files, 10)
        }
        finally {
            await srv.close()
        }
    })

})
