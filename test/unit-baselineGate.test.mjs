import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'
import createBaselineGate from '../src/createBaselineGate.mjs'
import runBaselineCase from '../src/runBaselineCase.mjs'
import createKnownDefect from '../src/createKnownDefect.mjs'


//篩選器之單元測試: 解析順序(階段圖鍵 → 案例鍵/邊界前綴 → 階段邊界前綴 → 依編號執行後驗證)、語系、未命中即拋錯、write-mode 與 outDir
//案例宣告取自 w-web-sso 之 tokens(多階段)與 logout(案例鍵＝首張階段圖鍵)、login(只比對案例)之實際形狀


let argvOf = (...xs) => ['node', 'x.test.mjs', '--baseline', ...xs]
let tokensCases = [
    { name: 'E2E-001-list-loaded' },
    { name: 'E2E-003-delete-row-save-success', stages: ['E2E-003-1-row-selected-before-save', 'E2E-003-2-delete-row-save-success'] },
    { name: 'E2E-005-grant-perms-save-success', stages: ['E2E-005-1-click-perms', 'E2E-005-2-perms-list', 'E2E-005-3-check-read-tokens'] },
    { name: 'E2E-007-view-perms-readonly' }, //多階段但未宣告 stages
]
let mk = (argv, extra = {}) => createBaselineGate({ langs: ['eng', 'cht'], cases: tokensCases, argv, env: {}, ...extra })


describe('createBaselineGate', function() {

    it('未給 --names: 全部案例、全部語系、全寫', function() {
        let g = mk(argvOf())
        assert.strict.equal(g.filtered, false)
        assert.strict.deepStrictEqual(g.langs, ['eng', 'cht'])
        assert.strict.deepStrictEqual(g.casesFor('cht').map((c) => c.name), tokensCases.map((c) => c.name))
        assert.strict.equal(g.shouldWrite('eng', 'E2E-005-grant-perms-save-success', 'E2E-005-2-perms-list'), true)
        g.finalize()
    })

    it('①階段圖鍵(帶語系): 只跑該案、只寫該張、只限該語系', function() {
        let g = mk(argvOf('--names', 'eng-E2E-005-3-check-read-tokens'))
        assert.strict.deepStrictEqual(g.casesFor('eng').map((c) => c.name), ['E2E-005-grant-perms-save-success'])
        assert.strict.deepStrictEqual(g.casesFor('cht'), [])
        assert.strict.equal(g.shouldWrite('eng', 'E2E-005-grant-perms-save-success', 'E2E-005-3-check-read-tokens'), true)
        assert.strict.equal(g.shouldWrite('eng', 'E2E-005-grant-perms-save-success', 'E2E-005-2-perms-list'), false)
        assert.strict.equal(g.shouldWrite('cht', 'E2E-005-grant-perms-save-success', 'E2E-005-3-check-read-tokens'), false)
    })

    it('②案例鍵: 寫該案全部階段; 不帶語系則套用全部語系', function() {
        let g = mk(argvOf('--names', 'E2E-003-delete-row-save-success'))
        for (let lang of ['eng', 'cht']) {
            assert.strict.deepStrictEqual(g.casesFor(lang).map((c) => c.name), ['E2E-003-delete-row-save-success'])
            assert.strict.equal(g.shouldWrite(lang, 'E2E-003-delete-row-save-success', 'E2E-003-1-row-selected-before-save'), true)
            assert.strict.equal(g.shouldWrite(lang, 'E2E-003-delete-row-save-success', 'E2E-003-2-delete-row-save-success'), true)
        }
    })

    it('②邊界前綴: E2E-005 命中 E2E-005-xxx 全部階段; 非邊界之 E2E-00 不命中任何鍵而拋錯', function() {
        let g = mk(argvOf('--names', 'cht-E2E-005'))
        assert.strict.deepStrictEqual(g.casesFor('cht').map((c) => c.name), ['E2E-005-grant-perms-save-success'])
        assert.strict.equal(g.shouldWrite('cht', 'E2E-005-grant-perms-save-success', 'E2E-005-1-click-perms'), true)
        assert.throws(() => mk(argvOf('--names', 'E2E-00')), /不符合任何案例或階段圖鍵/)
    })

    it('③階段邊界前綴: E2E-005-2 只寫 E2E-005-2-xxx', function() {
        let g = mk(argvOf('--names', 'eng-E2E-005-2'))
        assert.strict.equal(g.shouldWrite('eng', 'E2E-005-grant-perms-save-success', 'E2E-005-2-perms-list'), true)
        assert.strict.equal(g.shouldWrite('eng', 'E2E-005-grant-perms-save-success', 'E2E-005-1-click-perms'), false)
    })

    it('④未宣告 stages 之多階段案例: 依編號執行, 只寫相符者; 執行後未產出即由 finalize 拋錯', function() {
        let g = mk(argvOf('--names', 'eng-E2E-007-4-perms-list-readonly,eng-E2E-007-9-nope'))
        assert.strict.deepStrictEqual(g.casesFor('eng').map((c) => c.name), ['E2E-007-view-perms-readonly'])
        assert.strict.equal(g.shouldWrite('eng', 'E2E-007-view-perms-readonly', 'E2E-007-4-perms-list-readonly'), true)
        assert.strict.equal(g.shouldWrite('eng', 'E2E-007-view-perms-readonly', 'E2E-007-3-click-perms'), false)
        g.noteProduced('eng', 'E2E-007-view-perms-readonly', 'E2E-007-4-perms-list-readonly')
        assert.throws(() => g.finalize(), /eng-E2E-007-9-nope/)
    })

    it('案例鍵與首張階段圖鍵同名(logout 型): 給該鍵只寫該張, 給編號前綴才寫全部', function() {
        let cases = [{ name: 'E2E-001-1-logout-popup-open', stages: ['E2E-001-1-logout-popup-open', 'E2E-001-2-logout-done'] }]
        let g = createBaselineGate({ langs: ['eng'], cases, argv: argvOf('--names', 'eng-E2E-001-1-logout-popup-open'), env: {} })
        assert.strict.equal(g.shouldWrite('eng', 'E2E-001-1-logout-popup-open', 'E2E-001-1-logout-popup-open'), true)
        assert.strict.equal(g.shouldWrite('eng', 'E2E-001-1-logout-popup-open', 'E2E-001-2-logout-done'), false)
        let g2 = createBaselineGate({ langs: ['eng'], cases, argv: argvOf('--names', 'eng-E2E-001'), env: {} })
        assert.strict.equal(g2.shouldWrite('eng', 'E2E-001-1-logout-popup-open', 'E2E-001-2-logout-done'), true)
    })

    it('只比對案例(共用他案標準圖)被點名即拋錯; 全部案例模式照跑它(產製端跑流程與語意斷言、不寫圖, 技能 §7.9)', function() {
        let cases = [{ name: 'E2E-002-login-ok' }, { name: 'E2E-015-login-again', compareOnly: true }]
        assert.throws(() => createBaselineGate({ langs: ['eng'], cases, argv: argvOf('--names', 'eng-E2E-015'), env: {} }), /只比對/)
        let g = createBaselineGate({ langs: ['eng'], cases, argv: argvOf(), env: {} })
        assert.strict.deepStrictEqual(g.casesFor('eng').map((c) => c.name), ['E2E-002-login-ok', 'E2E-015-login-again'])
    })

    it('只比對案例宣告共用圖鍵為 stages 時: 點名該圖鍵只選產出該圖之案例(不誤判為多案例共有); 只命中只比對案例之鍵仍拋錯', function() {
        let cases = [
            { name: 'E2E-004-no-token', stages: ['E2E-004-no-token'] },
            { name: 'E2E-006-expired', stages: ['E2E-004-no-token'], compareOnly: true },
            { name: 'E2E-007-shared-only', stages: ['E2E-099-elsewhere'], compareOnly: true },
        ]
        let g = createBaselineGate({ langs: ['eng', 'cht'], cases, argv: argvOf('--names', 'E2E-004-no-token'), env: {} })
        assert.strict.deepStrictEqual(g.casesFor('eng').map((c) => c.name), ['E2E-004-no-token'])
        assert.strict.equal(g.shouldWrite('eng', 'E2E-004-no-token', 'E2E-004-no-token'), true)
        //邊界前綴亦同
        let g2 = createBaselineGate({ langs: ['eng'], cases, argv: argvOf('--names', 'E2E-004'), env: {} })
        assert.strict.deepStrictEqual(g2.casesFor('eng').map((c) => c.name), ['E2E-004-no-token'])
        assert.throws(() => createBaselineGate({ langs: ['eng'], cases, argv: argvOf('--names', 'E2E-099-elsewhere'), env: {} }), /只比對/)
        assert.throws(() => createBaselineGate({ langs: ['eng'], cases, argv: argvOf('--names', 'E2E-099'), env: {} }), /只比對/)
    })

    it('--langs 須完全等於已宣告語系; 與 --names 之語系前綴衝突即拋錯', function() {
        assert.throws(() => mk(argvOf('--langs', 'en')), /不是已宣告語系/)
        let g = mk(argvOf('--langs', 'cht', '--names', 'E2E-001-list-loaded'))
        assert.strict.deepStrictEqual(g.langs, ['cht'])
        assert.strict.deepStrictEqual(g.casesFor('eng'), [])
        assert.throws(() => mk(argvOf('--langs', 'cht', '--names', 'eng-E2E-001-list-loaded')), /衝突/)
    })

    it('旗標缺值或值為另一旗標即拋錯(防 --names --langs cht 把 --langs 吃成名單); 值會 trim', function() {
        assert.throws(() => mk(argvOf('--names', '--langs', 'cht')), /--names 缺少值/)
        assert.throws(() => mk(argvOf('--names')), /--names 缺少值/)
        let g = mk(argvOf('--names', ' eng-E2E-001-list-loaded , '))
        assert.strict.deepStrictEqual(g.casesFor('eng').map((c) => c.name), ['E2E-001-list-loaded'])
    })

    it('語系限定於案例宣告之 langs(例如只有 eng 之案例)', function() {
        let cases = [{ name: 'E2E-017-eye', langs: ['eng'] }, { name: 'E2E-001-a' }]
        let g = createBaselineGate({ langs: ['eng', 'cht'], cases, argv: argvOf(), env: {} })
        assert.strict.deepStrictEqual(g.casesFor('cht').map((c) => c.name), ['E2E-001-a'])
        assert.throws(() => createBaselineGate({ langs: ['eng', 'cht'], cases, argv: argvOf('--names', 'cht-E2E-017-eye'), env: {} }), /不符合任何案例/)
    })

    it('案例鍵重複或缺必要參數即拋錯', function() {
        assert.throws(() => createBaselineGate({ langs: ['eng'], cases: ['a', 'a'], argv: argvOf(), env: {} }), /案例鍵重複/)
        assert.throws(() => createBaselineGate({ langs: [], cases: ['a'] }), /langs/)
        assert.throws(() => createBaselineGate({ langs: ['eng'], cases: [] }), /cases/)
    })

    describe('write-mode 與 outDir', function() {
        let dir = path.resolve('./test/_tmp/baselineGate')
        let png = (w, h, v) => {
            let p = new PNG({ width: w, height: h })
            p.data.fill(v)
            for (let i = 3; i < p.data.length; i += 4) p.data[i] = 255
            return PNG.sync.write(p)
        }
        before(function() {
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, 'base.png'), png(20, 20, 100))
        })
        after(function() {
            fs.rmSync(dir, { recursive: true, force: true })
        })

        it('all: 一律寫; missing: 只寫不存在者; changed: 超過容差或尺寸不同才寫', function() {
            let base = path.join(dir, 'base.png')
            let none = path.join(dir, 'none.png')
            assert.strict.equal(mk(argvOf()).decideWrite(png(20, 20, 100), base).write, true)
            let gm = mk(argvOf('--write-mode', 'missing'))
            assert.strict.equal(gm.decideWrite(png(20, 20, 0), base).write, false)
            assert.strict.equal(gm.decideWrite(png(20, 20, 0), none).write, true)
            let gc = mk(argvOf('--write-mode', 'changed'), { maxDiffPixels: 100 })
            assert.strict.deepStrictEqual(gc.decideWrite(png(20, 20, 100), base), { write: false, reason: 'withinTolerance(diff=0px)' })
            assert.strict.equal(gc.decideWrite(png(20, 20, 0), base).write, true) //400px 全異 > 100
            assert.strict.equal(gc.decideWrite(png(21, 20, 100), base).reason, 'sizeChanged')
            assert.throws(() => mk(argvOf('--write-mode', 'some')), /write-mode/)
        })

        it('outDir: 寫出路徑改導至 outDir(取檔名), 未設則為原路徑', function() {
            let g = mk(argvOf(), { env: { E2E_BASELINE_OUT_DIR: dir } })
            assert.strict.equal(g.outPath('./test/pics/tokens/tokens-eng-E2E-001-list-loaded.png'), path.join(dir, 'tokens-eng-E2E-001-list-loaded.png'))
            assert.strict.equal(mk(argvOf()).outPath('./a/b.png'), './a/b.png')
        })
    })

    describe('孤兒檢查(靜態比對宣告圖鍵與標準圖目錄)', function() {
        let dir = path.resolve('./test/_tmp/baselineGate-orphans/pics/rela')
        let pathOf = (lang, key) => path.join(dir, `rela-${lang}-${key}.png`)
        let touch = (f) => fs.writeFileSync(path.join(dir, f), '') //孤兒檢查只看檔名
        let cases = [
            { name: 'E2E-005-belong-save', stages: ['E2E-005-1-source-row', 'E2E-005-9-click-save', 'E2E-005-10-belong-saved'] },
            { name: 'E2E-006-readonly-view', stages: ['E2E-006-1-readonly-view', 'E2E-006-2-row-collapsed'] }, //案例鍵剛好等於舊檔名(PERM 實例)
            { name: 'E2E-007-shared', compareOnly: true, stages: ['E2E-005-1-source-row'] }, //只比對: 共用他案之圖
            { name: 'E2E-008-eng-only', stages: ['E2E-008-x'], langs: ['eng'] }, //案例層語系
            { name: 'E2E-009-dynamic' }, //未宣告 stages: 以編號前綴為該案所有
        ]
        before(function() {
            fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true })
            fs.mkdirSync(dir, { recursive: true })
            for (let lang of ['eng', 'cht']) {
                for (let k of ['E2E-005-1-source-row', 'E2E-005-9-click-save', 'E2E-005-10-belong-saved', 'E2E-006-1-readonly-view', 'E2E-006-2-row-collapsed', 'E2E-009-dynamic', 'E2E-009-2-extra']) {
                    touch(`rela-${lang}-${k}.png`)
                }
            }
            touch('rela-eng-E2E-008-x.png')
            touch('_staref-eng-E2E-005-chart.png') //貼圖參考片段
            touch('rela-cht-E2E-006-readonly-view.png') //改名後之舊圖(孤兒)
            touch('rela-eng-E2E-005-9-click-chips-all.png') //舊階段名(孤兒)
            touch('rela-cht-E2E-008-x.png') //案例只有 eng, cht 之圖為孤兒
        })
        after(function() {
            let own = path.dirname(path.dirname(dir)) //test/_tmp/baselineGate-orphans
            fs.rmSync(own, { recursive: true, force: true })
            let parent = path.dirname(own)
            if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
                fs.rmdirSync(parent)
            }
        })

        it('findOrphanBaselines: 只列不是宣告圖鍵者; 案例鍵等於舊檔名不致漏報; _ 參考片段、只比對之共用圖、未宣告 stages 案例之編號前綴圖不誤報', async function() {
            let findOrphanBaselines = (await import('../src/findOrphanBaselines.mjs')).default
            let got = findOrphanBaselines({ cases, langs: ['eng', 'cht'], pathOf }).map((p) => path.basename(p))
            assert.strict.deepStrictEqual(got, ['rela-eng-E2E-005-9-click-chips-all.png', 'rela-cht-E2E-006-readonly-view.png', 'rela-cht-E2E-008-x.png'])
            assert.throws(() => findOrphanBaselines({ cases, langs: ['eng'], pathOf: (lang, key) => path.join(dir, key, 'x.png') }), /圖鍵須在檔名內/)
        })

        it('gate: 給 pathOf(或經 usePathOf 告知)時 finalize 列出孤兒並拋錯; 與 --names 局部執行無關(靜態); 無孤兒則通過', function() {
            let g = createBaselineGate({ langs: ['eng', 'cht'], cases, argv: argvOf(), env: {}, pathOf })
            assert.throws(() => g.finalize(), /3 張孤兒圖[\s\S]*rela-cht-E2E-006-readonly-view\.png/)
            //局部執行(--names 一項)仍靜態檢查整個目錄
            let g2 = createBaselineGate({ langs: ['eng', 'cht'], cases, argv: argvOf('--names', 'E2E-005-9-click-save'), env: {} })
            g2.usePathOf(pathOf)
            g2.noteProduced('eng', 'E2E-005-belong-save', 'E2E-005-9-click-save')
            g2.noteProduced('cht', 'E2E-005-belong-save', 'E2E-005-9-click-save')
            assert.throws(() => g2.finalize(), /孤兒圖/)
            //未給 pathOf 不檢查
            assert.doesNotThrow(() => createBaselineGate({ langs: ['eng', 'cht'], cases, argv: argvOf(), env: {} }).finalize())
            //清掉孤兒後通過
            for (let f of ['rela-eng-E2E-005-9-click-chips-all.png', 'rela-cht-E2E-006-readonly-view.png', 'rela-cht-E2E-008-x.png']) {
                fs.rmSync(path.join(dir, f))
            }
            assert.doesNotThrow(() => g.finalize())
            assert.strict.deepStrictEqual(g.orphans(), [])
        })
    })

})


//已知缺陷之紀錄: runBaselineCase 於缺陷分支自動呼叫 gate.noteKnownDefect, finalize 據以不把「因缺陷未產」當 --names 未命中
//(整案缺陷與部分缺陷共用同一套紀錄); 測試標題前綴 [B..] 對應 CLAUDE_rulebook.md 表 B
describe('createBaselineGate 已知缺陷紀錄(noteKnownDefect 與 finalize)', function() {
    let B = (s) => Buffer.from(s)
    let S4 = ['E2E-018-1-a', 'E2E-018-2-b', 'E2E-018-3-c', 'E2E-018-4-d']
    let front3 = () => ({ 'E2E-018-1-a': B('1'), 'E2E-018-2-b': B('2'), 'E2E-018-3-c': B('3') })
    let caseDecl = [
        { name: 'E2E-001-ok' },
        { name: 'E2E-013-no-station', stages: ['E2E-013-1-x'] },
        { name: 'E2E-018-x', stages: S4 },
        { name: 'E2E-007-view' }, //未宣告 stages(④路徑)
    ]
    let fakeBrowser = () => ({
        async newContext() {
            return {
                async newPage() {
                    return { on() {} }
                },
            }
        },
        async close() {},
    })
    let runWhole = async () => {
        throw createKnownDefect('整案缺陷', { ref: 'spec 已知落差' })
    }
    let runPartial = async () => {
        throw createKnownDefect('第4步走到缺陷', { ref: 'spec 已知落差', shots: front3() })
    }
    let runFull = async () => ({ ...front3(), 'E2E-018-4-d': B('4') })
    let gateOf = (names, logs = [], extra = []) => createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf('--names', names, ...extra), env: {}, log: (s) => logs.push(s) })
    let go = (gate, name, run, extra = {}) => runBaselineCase({
        mode: 'regen',
        lang: 'eng',
        name,
        launch: async () => fakeBrowser(),
        run,
        pathOf: (l, k) => `./test/pics/x/x-${l}-${k}.png`,
        gate,
        writeFile: () => {},
        log: () => {},
        ...extra,
    })
    let dirs = []
    let tmpDir = (name) => {
        let d = path.resolve('./test/_tmp', name)
        fs.rmSync(d, { recursive: true, force: true })
        fs.mkdirSync(d, { recursive: true })
        dirs.push(d)
        return d
    }
    after(function() {
        for (let d of dirs) {
            fs.rmSync(d, { recursive: true, force: true })
        }
        let parent = path.resolve('./test/_tmp')
        if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent)
        }
    })

    it('[B05/B06] --names 只命中整案缺陷案例(案例鍵 / 邊界前綴 / 階段圖鍵): finalize 不拋錯, 回傳與日誌列出「已知缺陷未產」', async function() {
        for (let names of ['eng-E2E-013', 'E2E-013-no-station', 'eng-E2E-013-1-x']) {
            let logs = []
            let g = gateOf(names, logs)
            let r = await go(g, 'E2E-013-no-station', runWhole)
            assert.strict.equal(r.status, 'knownDefect')
            let sum = g.finalize()
            assert.strict.equal(sum.knownDefects.length, 1, names)
            assert.strict.equal(sum.knownDefects[0].name, 'E2E-013-no-station')
            assert.strict.equal(sum.knownDefects[0].keys, null)
            assert.strict.ok(logs.some((l) => l.includes('已知缺陷未產') && l.includes('E2E-013-no-station') && l.includes('整案')), names)
        }
    })

    it('[B03/B04] 不放過真正之未命中: ④案例 token 拼錯, 即使同批有缺陷案例仍由 finalize 拋; 宣告 stages 之拼錯於構造時拋', async function() {
        let g = gateOf('eng-E2E-007-9-nope,eng-E2E-013')
        await go(g, 'E2E-007-view', async () => ({ 'E2E-007-1-a': B('1') }))
        await go(g, 'E2E-013-no-station', runWhole)
        assert.throws(() => g.finalize(), (e) => /eng-E2E-007-9-nope/.test(e.message) && !/eng-E2E-013(,|\s|$)/.test(e.message))
        assert.throws(() => gateOf('eng-E2E-013-1-xx'), /不符合任何案例或階段圖鍵/)
    })

    it('[B12] token 選中缺陷案例但案例未執行(沒走到 runBaselineCase): 仍拋(只有實際記下缺陷者才豁免)', function() {
        let g = gateOf('eng-E2E-013')
        assert.throws(() => g.finalize(), /eng-E2E-013/)
    })

    it('[B07-B09] 部分缺陷: 點名缺陷步圖鍵 / 前段圖鍵 / 案例鍵皆不拋, 摘要列出未產鍵', async function() {
        for (let names of ['eng-E2E-018-4-d', 'eng-E2E-018-1-a', 'E2E-018']) {
            let logs = []
            let g = gateOf(names, logs)
            let r = await go(g, 'E2E-018-x', runPartial, { stages: S4, defectStages: ['E2E-018-4-d'] })
            assert.strict.equal(r.status, 'knownDefect')
            let sum = g.finalize()
            assert.strict.deepStrictEqual(sum.knownDefects[0].keys, ['E2E-018-4-d'], names)
            assert.strict.ok(logs.some((l) => l.includes('E2E-018-4-d')), names)
        }
    })

    it('[B10] 前段 token 本身未被產出仍判未命中(缺陷步豁免不及於前段), 訊息只列前段那個', function() {
        let g = gateOf('eng-E2E-018-1-a,eng-E2E-018-4-d')
        g.noteKnownDefect('eng', 'E2E-018-x', { keys: ['E2E-018-4-d'] })
        assert.throws(() => g.finalize(), (e) => /eng-E2E-018-1-a/.test(e.message) && !/eng-E2E-018-4-d/.test(e.message.split('\n')[0]))
    })

    it('[B11] 缺陷已修復: 點名缺陷步圖鍵且 run 走完 → 正常寫出該張, finalize 通過, 無缺陷摘要', async function() {
        let logs = []
        let g = gateOf('eng-E2E-018-4-d', logs)
        let r = await go(g, 'E2E-018-x', runFull, { stages: S4, defectStages: ['E2E-018-4-d'] })
        assert.strict.equal(r.status, 'regen')
        assert.strict.deepStrictEqual(r.written, ['E2E-018-4-d'])
        assert.strict.deepStrictEqual(g.finalize().knownDefects, [])
        assert.strict.equal(logs.length, 0)
    })

    it('[B13] 混合: 缺陷案例 token+正常案例 token——正常案例產出則通過; 未產出則只列正常案例那個', async function() {
        let g = gateOf('eng-E2E-013,eng-E2E-001-ok')
        await go(g, 'E2E-013-no-station', runWhole)
        await go(g, 'E2E-001-ok', async () => B('1'))
        assert.strict.equal(g.finalize().knownDefects.length, 1)
        let g2 = gateOf('eng-E2E-013,eng-E2E-001-ok')
        await go(g2, 'E2E-013-no-station', runWhole)
        assert.throws(() => g2.finalize(), (e) => /eng-E2E-001-ok/.test(e.message) && !/eng-E2E-013(,|\s|$)/.test(e.message))
    })

    it('[B01] 未篩選(全跑): 只記錄不影響 finalize; 印摘要; log:null 不印; 無缺陷時回傳空陣列且不印', function() {
        let logs = []
        let g = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: (s) => logs.push(s) })
        g.noteKnownDefect('eng', 'E2E-013-no-station', { message: 'm', ref: 'r' })
        let sum = g.finalize()
        assert.strict.deepStrictEqual(sum.knownDefects, [{ lang: 'eng', name: 'E2E-013-no-station', keys: null, message: 'm', ref: 'r' }])
        assert.strict.equal(logs.length, 1)
        let g2 = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: null })
        g2.noteKnownDefect('eng', 'E2E-013-no-station')
        assert.strict.equal(g2.finalize().knownDefects.length, 1)
        let g3 = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: () => assert.fail('不應印') })
        assert.strict.deepStrictEqual(g3.finalize().knownDefects, [])
    })

    it('[B15] 已知限制: 未宣告 stages 之案例整案缺陷時, ④token(含拼錯者)無法驗證圖鍵 → 不拋, 摘要仍列出該案', async function() {
        let logs = []
        let g = gateOf('eng-E2E-007-9-nope', logs)
        await go(g, 'E2E-007-view', runWhole)
        let sum = g.finalize()
        assert.strict.equal(sum.knownDefects[0].name, 'E2E-007-view')
        assert.strict.ok(logs.some((l) => l.includes('E2E-007-view')))
    })

    it('[B18] 前段 token 配 --write-mode missing, 標準圖已存在: keep 仍算已產出, finalize 通過', async function() {
        let dir = tmpDir('baselineGate-defect-wm')
        fs.writeFileSync(path.join(dir, 'x-eng-E2E-018-1-a.png'), 'x')
        let g = gateOf('eng-E2E-018-1-a', [], ['--write-mode', 'missing'])
        let r = await go(g, 'E2E-018-x', runPartial, { stages: S4, defectStages: ['E2E-018-4-d'], pathOf: (l, k) => path.join(dir, `x-${l}-${k}.png`) })
        assert.strict.deepStrictEqual(r.kept, ['E2E-018-1-a'])
        g.finalize()
    })

    it('[B16] 孤兒檢查不受影響: 孤兒圖與缺陷紀錄並存時摘要先印、孤兒仍拋; 缺陷步之舊凍結圖屬宣告 stages, 不算孤兒', function() {
        let dir = tmpDir('baselineGate-defect-orphans')
        fs.writeFileSync(path.join(dir, 'x-eng-E2E-999-old.png'), '')
        fs.writeFileSync(path.join(dir, 'x-eng-E2E-018-4-d.png'), '')
        let logs = []
        let g = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: (s) => logs.push(s), pathOf: (l, k) => path.join(dir, `x-${l}-${k}.png`) })
        g.noteKnownDefect('eng', 'E2E-018-x', { keys: ['E2E-018-4-d'] })
        assert.throws(() => g.finalize(), (e) => /E2E-999-old/.test(e.message) && !/E2E-018-4-d/.test(e.message))
        assert.strict.equal(logs.length, 1)
    })

    it('[B21] 已知限制: 豁免與產出皆以 token 為單位(any-of), 無語系前綴之 token 選中多語系 / 多案例時, 任一目標已產出或記缺陷即視為命中(與既有 noteProduced 同語意, 非本次引入)', async function() {
        let two = (names, logs = []) => createBaselineGate({ langs: ['eng', 'cht'], cases: caseDecl, argv: argvOf('--names', names), env: {}, log: (s) => logs.push(s) })
        //既有語意: 正常案例只跑 eng, cht 未執行, 無語系前綴之 token 仍判已產出
        let g1 = two('E2E-001-ok')
        g1.noteProduced('eng', 'E2E-001-ok', 'E2E-001-ok')
        assert.strict.doesNotThrow(() => g1.finalize())
        //延伸至缺陷: 只有 eng 記整案缺陷, cht 未執行, 同一 token 仍視為命中; 帶語系前綴者則各自獨立
        let g2 = two('E2E-013')
        g2.noteKnownDefect('eng', 'E2E-013-no-station')
        assert.strict.equal(g2.finalize().knownDefects.length, 1)
        let g3 = two('eng-E2E-013,cht-E2E-013')
        g3.noteKnownDefect('eng', 'E2E-013-no-station')
        assert.throws(() => g3.finalize(), /cht-E2E-013/)
        //同一 token 以邊界前綴選中多案例: 一案記缺陷即豁免, 另一案(未執行)不被個別追蹤
        let g4 = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-005-a' }, { name: 'E2E-005-b' }], argv: argvOf('--names', 'E2E-005'), env: {}, log: () => {} })
        assert.strict.deepStrictEqual(g4.casesFor('eng').map((c) => c.name), ['E2E-005-a', 'E2E-005-b'])
        g4.noteKnownDefect('eng', 'E2E-005-a')
        assert.strict.equal(g4.finalize().knownDefects.length, 1) //E2E-005-b 未執行亦通過(token 層級)
    })

    it('[B22] 部分缺陷 + 未宣告 stages(經 runBaselineCase): 前段 token 已產出而通過; 點名缺陷步圖鍵(④)無法判定為缺陷, 仍由 finalize 以未產出拋; 摘要註明未列缺陷步圖鍵', async function() {
        let partial = async () => {
            throw createKnownDefect('x', { ref: 'r', shots: { 'E2E-007-1-a': B('1'), 'E2E-007-2-b': B('2') } })
        }
        let logs = []
        let g = gateOf('eng-E2E-007-1-a', logs)
        let r = await go(g, 'E2E-007-view', partial)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.deepStrictEqual(r.defectStages, [])
        assert.strict.equal(g.finalize().knownDefects[0].keys.length, 0)
        assert.strict.ok(logs.some((l) => l.includes('未列缺陷步圖鍵')))
        let g2 = gateOf('eng-E2E-007-3-d')
        await go(g2, 'E2E-007-view', partial)
        assert.throws(() => g2.finalize(), /eng-E2E-007-3-d/)
    })

    it('[B19] noteKnownDefect 之 keys 型別: 僅省略 / undefined / null(整案)或圖鍵字串陣列(含空陣列)合法; 其餘拋錯且不留紀錄, 不把部分豁免擴大成整案', function() {
        for (let bad of ['E2E-018-4-d', {}, 0, ['E2E-018-4-d', 1], [''], [null]]) {
            let g = gateOf('eng-E2E-018-1-a,eng-E2E-018-4-d')
            assert.throws(() => g.noteKnownDefect('eng', 'E2E-018-x', { keys: bad }), /keys 須省略/, JSON.stringify(bad))
            assert.throws(() => g.finalize(), /eng-E2E-018-1-a/) //前段 token 未被誤放
            let g2 = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: null })
            assert.throws(() => g2.noteKnownDefect('eng', 'E2E-018-x', { keys: bad }), /keys 須省略/)
            assert.strict.deepStrictEqual(g2.finalize().knownDefects, []) //不留紀錄
        }
        let ok = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: null })
        ok.noteKnownDefect('eng', 'E2E-018-x', { keys: [] })
        ok.noteKnownDefect('eng', 'E2E-013-no-station', { keys: undefined })
        ok.noteKnownDefect('eng', 'E2E-001-ok', { keys: null })
        assert.strict.deepStrictEqual(ok.finalize().knownDefects.map((k) => k.keys), [[], null, null])
    })

    it('[B20] finalize 回傳為獨立快照: 改壞回傳之 keys 不影響再次 finalize 之摘要', function() {
        let g = createBaselineGate({ langs: ['eng'], cases: caseDecl, argv: argvOf(), env: {}, log: null })
        let keys = ['E2E-018-4-d']
        g.noteKnownDefect('eng', 'E2E-018-x', { keys })
        keys.push('mutated-input') //輸入端亦已複製
        let r = g.finalize()
        r.knownDefects[0].keys[0] = 'CORRUPTED'
        r.knownDefects.push({ x: 1 })
        assert.strict.deepStrictEqual(g.finalize().knownDefects.map((k) => k.keys), [['E2E-018-4-d']])
    })

    it('noteKnownDefect 對未選中 / 未知之案例與語系只記錄、不誤覆蓋其他 token', function() {
        let g = gateOf('eng-E2E-001-ok')
        g.noteKnownDefect('eng', 'E2E-013-no-station', {})
        g.noteKnownDefect('cht', 'E2E-013-no-station', {})
        assert.throws(() => g.finalize(), /eng-E2E-001-ok/)
    })
})
