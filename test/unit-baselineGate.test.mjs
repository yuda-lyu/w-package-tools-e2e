import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'
import createBaselineGate from '../src/createBaselineGate.mjs'


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
