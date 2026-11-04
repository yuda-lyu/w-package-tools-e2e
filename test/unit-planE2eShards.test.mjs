import assert from 'assert'
import planE2eShards from '../src/planE2eShards.mjs'


//分組與記憶體守門(純函數, 全以注入值, 不依賴本機): 規格見 sgud/rule/rulebook_shard.md 規則 S-G*、S-M*


let d = { 'e2e-a.test.mjs': 10, 'e2e-b.test.mjs': 8, 'e2e-c.test.mjs': 6, 'e2e-d.test.mjs': 5, 'e2e-e.test.mjs': 1 }
let files = Object.keys(d)
let filesOf = (p) => p.groups.map((g) => g.files)


describe('planE2eShards', function() {

    describe('[S-G1] 由大到小放入目前最輕之組', function() {

        it('2 組: 10→0, 8→1, 6→1(8<10), 5→0(10<14), 1→1(14<15)', function() {
            let r = planE2eShards({ files, instances: 2, durations: d })
            assert.strict.deepEqual(filesOf(r), [
                ['e2e-a.test.mjs', 'e2e-d.test.mjs'],
                ['e2e-b.test.mjs', 'e2e-c.test.mjs', 'e2e-e.test.mjs'],
            ])
            assert.strict.deepEqual(r.groups.map((g) => g.estMin), [15, 15])
            assert.strict.equal(r.wallMin, 15)
            assert.strict.equal(r.serialMin, 30)
        })

        it('依耗時而非檔名決定放入順序: a(1)、b(10)、c(8) → b→0, c→1, a→1', function() {
            let r = planE2eShards({
                files: ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs'],
                instances: 2,
                durations: { 'e2e-a.test.mjs': 1, 'e2e-b.test.mjs': 10, 'e2e-c.test.mjs': 8 },
            })
            assert.strict.deepEqual(filesOf(r), [['e2e-b.test.mjs'], ['e2e-a.test.mjs', 'e2e-c.test.mjs']])
            assert.strict.deepEqual(r.groups.map((g) => g.estMin), [10, 9])
        })

        it('結果與輸入順序無關(檔案、durations 鍵序、together 內序)', function() {
            let a = planE2eShards({ files, instances: 3, durations: d, together: [['e2e-a.test.mjs', 'e2e-e.test.mjs']] })
            let b = planE2eShards({
                files: files.slice().reverse(),
                instances: 3,
                durations: Object.fromEntries(Object.entries(d).reverse()),
                together: [['e2e-e.test.mjs', 'e2e-a.test.mjs']],
            })
            assert.strict.deepEqual(filesOf(a), filesOf(b))
        })

        it('同耗時依檔名排序, 同輕取編號小者', function() {
            let r = planE2eShards({ files: ['e2e-b.test.mjs', 'e2e-a.test.mjs', 'e2e-c.test.mjs'], instances: 2, durations: { 'e2e-a.test.mjs': 1, 'e2e-b.test.mjs': 1, 'e2e-c.test.mjs': 1 } })
            assert.strict.deepEqual(filesOf(r), [['e2e-a.test.mjs', 'e2e-c.test.mjs'], ['e2e-b.test.mjs']])
        })

    })

    describe('[S-G2] officialOnly 固定在第 0 組', function() {

        it('耗時最小之 officialOnly 仍在第 0 組, 且該組仍可再放其他檔', function() {
            let r = planE2eShards({ files, instances: 2, durations: d, officialOnly: ['e2e-e.test.mjs'] })
            assert.strict.ok(r.groups[0].files.includes('e2e-e.test.mjs'))
            assert.strict.deepEqual(r.groups[0].officialOnly, ['e2e-e.test.mjs'])
            assert.strict.deepEqual(r.groups[1].officialOnly, [])
            //e(1)固定第0組; a(10)→1; b(8)→0(1<10); c(6)→0(9<10); d(5)→1(10<15)
            assert.strict.deepEqual(filesOf(r), [
                ['e2e-b.test.mjs', 'e2e-c.test.mjs', 'e2e-e.test.mjs'],
                ['e2e-a.test.mjs', 'e2e-d.test.mjs'],
            ])
        })

        it('多個 officialOnly 全在第 0 組', function() {
            let r = planE2eShards({ files, instances: 4, durations: d, officialOnly: ['e2e-a.test.mjs', 'e2e-b.test.mjs'] })
            assert.strict.deepEqual(r.groups[0].officialOnly, ['e2e-a.test.mjs', 'e2e-b.test.mjs'])
        })

        it('officialOnly 與 together 同集合者整組跟到第 0 組', function() {
            let r = planE2eShards({ files, instances: 3, durations: d, officialOnly: ['e2e-e.test.mjs'], together: [['e2e-a.test.mjs', 'e2e-e.test.mjs']] })
            assert.strict.ok(r.groups[0].files.includes('e2e-a.test.mjs'))
            assert.strict.ok(r.groups[0].files.includes('e2e-e.test.mjs'))
        })

        it('officialOnly 含不存在之檔名即拋錯(改名未同步不得靜默跑到位移埠)', function() {
            assert.throws(() => planE2eShards({ files, officialOnly: ['e2e-x.test.mjs'] }), /officialOnly 含不存在之檔名: e2e-x\.test\.mjs/)
            assert.throws(() => planE2eShards({ files, officialOnly: 'e2e-a.test.mjs' }), /officialOnly 須為檔名陣列/)
        })

    })

    describe('[S-G3] together 不拆開', function() {

        it('同組且耗時合計參與分組', function() {
            let r = planE2eShards({ files, instances: 2, durations: d, together: [['e2e-d.test.mjs', 'e2e-e.test.mjs']] })
            let g = r.groups.find((v) => v.files.includes('e2e-d.test.mjs'))
            assert.strict.ok(g.files.includes('e2e-e.test.mjs'))
        })

        it('有交集之 together 合併(遞移)', function() {
            let r = planE2eShards({ files, instances: 5, durations: d, together: [['e2e-a.test.mjs', 'e2e-b.test.mjs'], ['e2e-b.test.mjs', 'e2e-c.test.mjs']] })
            let g = r.groups.find((v) => v.files.includes('e2e-a.test.mjs'))
            assert.strict.deepEqual(g.files, ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs'])
            assert.strict.equal(r.instancesUsed, 3)
        })

        it('together 含不存在之檔名或型別錯誤即拋錯', function() {
            assert.throws(() => planE2eShards({ files, together: [['e2e-a.test.mjs', 'e2e-x.test.mjs']] }), /together 含不存在之檔名/)
            assert.throws(() => planE2eShards({ files, together: 'x' }), /together 須為檔名陣列之陣列/)
            assert.throws(() => planE2eShards({ files, together: ['e2e-a.test.mjs'] }), /together 須為檔名陣列/)
        })

    })

    describe('[S-G4] 缺 durations 以已知檔之平均值估算', function() {

        it('缺者採已知平均(10+8)/2=9 並列於 unknownFiles', function() {
            let r = planE2eShards({
                files: ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs'],
                instances: 2,
                durations: { 'e2e-a.test.mjs': 10, 'e2e-b.test.mjs': 8 },
            })
            assert.strict.deepEqual(r.unknownFiles, ['e2e-c.test.mjs'])
            assert.strict.equal(r.estimated['e2e-c.test.mjs'], 9)
            //10→0, 9→1, 8→1(9<10)
            assert.strict.deepEqual(filesOf(r), [['e2e-a.test.mjs'], ['e2e-b.test.mjs', 'e2e-c.test.mjs']])
        })

        it('全無已知值時每檔以 1 分計; 非正數與非數字視同未知; 數字字串可用', function() {
            let r0 = planE2eShards({ files: ['e2e-a.test.mjs', 'e2e-b.test.mjs'], instances: 2 })
            assert.strict.deepEqual(r0.estimated, { 'e2e-a.test.mjs': 1, 'e2e-b.test.mjs': 1 })
            let r1 = planE2eShards({ files: ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs'], durations: { 'e2e-a.test.mjs': -3, 'e2e-b.test.mjs': 'x', 'e2e-c.test.mjs': '4' } })
            assert.strict.deepEqual(r1.unknownFiles, ['e2e-a.test.mjs', 'e2e-b.test.mjs'])
            assert.strict.equal(r1.estimated['e2e-c.test.mjs'], 4)
        })

    })

    describe('[S-G5] 實例數不超過檔案數', function() {

        it('實例 5、檔案 2 → 2 組並印原因', function() {
            let r = planE2eShards({ files: ['e2e-a.test.mjs', 'e2e-b.test.mjs'], instances: 5 })
            assert.strict.equal(r.instancesRequested, 5)
            assert.strict.equal(r.instancesUsed, 2)
            assert.strict.equal(r.groups.length, 2)
            assert.strict.ok(r.reasons.some((v) => /只有 2 個/.test(v)))
        })

        it('together 使可分開之單元少於檔案數時依單元數', function() {
            let r = planE2eShards({ files: ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs'], instances: 5, together: [['e2e-a.test.mjs', 'e2e-b.test.mjs']] })
            assert.strict.equal(r.instancesUsed, 2)
        })

        it('全為 officialOnly 時只有 1 組', function() {
            let r = planE2eShards({ files: ['e2e-a.test.mjs', 'e2e-b.test.mjs'], instances: 5, officialOnly: ['e2e-a.test.mjs', 'e2e-b.test.mjs'] })
            assert.strict.equal(r.instancesUsed, 1)
            assert.strict.deepEqual(filesOf(r), [['e2e-a.test.mjs', 'e2e-b.test.mjs']])
        })

        it('未給實例數預設 5; 非預期值改用預設 5(K3)', function() {
            let many = Array.from({ length: 9 }, (_, i) => `e2e-${i}.test.mjs`)
            assert.strict.equal(planE2eShards({ files: many }).instancesUsed, 5)
            assert.strict.equal(planE2eShards({ files: many, instances: 'x' }).instancesUsed, 5)
            assert.strict.equal(planE2eShards({ files: many, instances: 0 }).instancesUsed, 5)
            assert.strict.equal(planE2eShards({ files: many, instances: 2.5 }).instancesUsed, 5)
            assert.strict.equal(planE2eShards({ files: many, instances: '3' }).instancesUsed, 3)
        })

        it('files 空或型別錯誤即拋錯', function() {
            assert.throws(() => planE2eShards({ files: [] }), /files 須為非空/)
            assert.throws(() => planE2eShards({}), /files 須為非空/)
            assert.throws(() => planE2eShards({ files: [1] }), /files 須為非空/)
        })

    })

    describe('[S-M1] 記憶體守門', function() {

        let many = Array.from({ length: 9 }, (_, i) => `e2e-${i}.test.mjs`)

        it('可用 6 GB ÷ 1.5 = 4 → 實例 5 調降為 4 並印原因', function() {
            let r = planE2eShards({ files: many, instances: 5, availMemGb: 6, memPerInstanceGb: 1.5 })
            assert.strict.equal(r.instancesUsed, 4)
            assert.strict.ok(r.reasons.some((v) => /6 GB ÷ 每實例 1\.5 GB = 4 個, 實例數 5 → 4/.test(v)), JSON.stringify(r.reasons))
            assert.strict.deepEqual(r.warnings, [])
        })

        it('未給 memPerInstanceGb 預設 1.5; 可調', function() {
            assert.strict.equal(planE2eShards({ files: many, instances: 5, availMemGb: 4.5 }).instancesUsed, 3)
            assert.strict.equal(planE2eShards({ files: many, instances: 5, availMemGb: 4.5, memPerInstanceGb: 2 }).instancesUsed, 2)
            assert.strict.equal(planE2eShards({ files: many, instances: 5, availMemGb: 4.5, memPerInstanceGb: 'x' }).instancesUsed, 3)
        })

        it('連 1 個都不夠時仍跑 1 個並警告', function() {
            let r = planE2eShards({ files: many, instances: 5, availMemGb: 0.4, memPerInstanceGb: 1.5 })
            assert.strict.equal(r.instancesUsed, 1)
            assert.strict.ok(r.warnings.some((v) => /不足 1 個實例.*仍跑 1 個/.test(v)), JSON.stringify(r.warnings))
            assert.strict.equal(r.groups[0].files.length, 9)
        })

        it('記憶體足夠不調降; 未給可用記憶體不守門', function() {
            let r = planE2eShards({ files: many, instances: 5, availMemGb: 100 })
            assert.strict.equal(r.instancesUsed, 5)
            assert.strict.deepEqual(r.reasons, [])
            assert.strict.equal(planE2eShards({ files: many, instances: 5 }).instancesUsed, 5)
        })

        it('調降後 officialOnly 仍在第 0 組', function() {
            let r = planE2eShards({ files: many, instances: 5, availMemGb: 3, officialOnly: ['e2e-8.test.mjs'] })
            assert.strict.equal(r.instancesUsed, 2)
            assert.strict.ok(r.groups[0].files.includes('e2e-8.test.mjs'))
        })

    })

})
