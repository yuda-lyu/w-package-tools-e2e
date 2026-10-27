import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { PNG } from 'pngjs'
import writeBaselineIfChanged, { resolveKeepSame } from '../src/writeBaselineIfChanged.mjs'
import runBaselineCase from '../src/runBaselineCase.mjs'
import createBaselineGate from '../src/createBaselineGate.mjs'


//有變更才改寫(Gitea issue #19 第2項)之單元測試: 預設不變(直接寫、不讀標準圖)、E2E_BASELINE_KEEP_SAME／KEEP_MAXDIFF 之判定、
//暫時狀態圖、比對端覆蓋(compareBuf)兩端共用、runBaselineCase 之寫檔入口(相同者 mtime 不變); 中介資料落 ./test/_tmp/keepSame, 測完刪除


let fdTmp = path.resolve('./test/_tmp/keepSame')

//純色圖(底色 bg), 另把 dots 個像素改黑
function png(w, h, dots = 0, bg = 250) {
    let p = new PNG({ width: w, height: h })
    for (let i = 0; i < w * h; i++) {
        p.data[i * 4] = bg
        p.data[i * 4 + 1] = bg
        p.data[i * 4 + 2] = bg
        p.data[i * 4 + 3] = 255
    }
    for (let k = 0; k < dots; k++) {
        let x = 10 + (k % 100) * 2
        let y = 10 + Math.floor(k / 100) * 3
        let i = (y * w + x) * 4
        p.data[i] = 0
        p.data[i + 1] = 0
        p.data[i + 2] = 0
    }
    return PNG.sync.write(p)
}

let BASE = png(300, 200)
let OLD = new Date('2026-01-02T03:04:05Z')
let fpOf = (name) => path.join(fdTmp, 'pics', `${name}.png`)

//寫一張標準圖並把 mtime 設為過去時刻(改寫即可由 mtime 看出)
function seed(name, buf = BASE) {
    let fp = fpOf(name)
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, buf)
    fs.utimesSync(fp, OLD, OLD)
    return fp
}
let mtimeOf = (fp) => fs.statSync(fp).mtime.getTime()

function spyWrite() {
    let calls = []
    let fn = (p, b) => {
        calls.push(p)
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, b)
    }
    return { calls, fn }
}


describe('有變更才改寫(keepSame)', function() {

    beforeEach(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
    })

    describe('writeBaselineIfChanged', function() {

        it('[K01] 預設不變: E2E_BASELINE_KEEP_SAME 未設時即使與標準圖相同仍寫出, 不呼叫比對端覆蓋, reason 為空', async function() {
            let fp = seed('a')
            let w = spyWrite()
            let toCompareCalls = 0
            let r = await writeBaselineIfChanged(BASE, fp, {
                env: {},
                writeFile: w.fn,
                toCompare: async (b) => {
                    toCompareCalls++
                    return b
                }
            })
            assert.strict.deepStrictEqual(r, { written: true, reason: '', numDiff: null })
            assert.strict.deepStrictEqual([w.calls, toCompareCalls], [[fp], 0])
            assert.notStrictEqual(mtimeOf(fp), OLD.getTime())
            //E2E_BASELINE_KEEP_MAXDIFF 單獨設定(KEEP_SAME 未設)不生效、不驗格式
            let r2 = await writeBaselineIfChanged(BASE, fp, { env: { E2E_BASELINE_KEEP_MAXDIFF: 'abc' }, writeFile: w.fn })
            assert.strict.equal(r2.written, true)
        })

        it('[K02] KEEP_SAME=1: RGBA 相同者不寫(mtime 不變), 容差內(預設上限=比對端 maxDiffPixels 100)亦保留, 超過即寫', async function() {
            let env = { E2E_BASELINE_KEEP_SAME: '1' }
            let fp = seed('a')
            let r = await writeBaselineIfChanged(png(300, 200), fp, { env })
            assert.strict.deepStrictEqual(r, { written: false, reason: 'same', numDiff: 0 })
            assert.strict.equal(mtimeOf(fp), OLD.getTime())
            let r50 = await writeBaselineIfChanged(png(300, 200, 50), fp, { env })
            assert.strict.deepStrictEqual(r50, { written: false, reason: 'same(diff=50px≤100)', numDiff: 50 })
            assert.strict.equal(mtimeOf(fp), OLD.getTime())
            let r150 = await writeBaselineIfChanged(png(300, 200, 150), fp, { env })
            assert.strict.deepStrictEqual(r150, { written: true, reason: 'diff=150px', numDiff: 150 })
            assert.ok(fs.readFileSync(fp).equals(png(300, 200, 150)))
        })

        it('[K03] KEEP_MAXDIFF=0 只保留 RGBA 完全相同者(pixelmatch 計數 0 而 RGBA 不同者照寫); KEEP_MAXDIFF=200 放寬上限', async function() {
            let fp = seed('a')
            let env0 = { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: '0' }
            assert.strict.deepStrictEqual(await writeBaselineIfChanged(BASE, fp, { env: env0 }), { written: false, reason: 'same', numDiff: 0 })
            assert.strict.equal(mtimeOf(fp), OLD.getTime())
            //整張亮度 +1: threshold 0.1 下 pixelmatch 計 0, 但 RGBA 不同
            let r1 = await writeBaselineIfChanged(png(300, 200, 0, 251), fp, { env: env0 })
            assert.strict.deepStrictEqual(r1, { written: true, reason: 'rgbaDiff(diff=0px)', numDiff: 0 })
            seed('a')
            let r5 = await writeBaselineIfChanged(png(300, 200, 5), fp, { env: env0 })
            assert.strict.deepStrictEqual(r5, { written: true, reason: 'diff=5px', numDiff: 5 })
            seed('a')
            let r150 = await writeBaselineIfChanged(png(300, 200, 150), fp, { env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: '200' } })
            assert.strict.deepStrictEqual(r150, { written: false, reason: 'same(diff=150px≤200)', numDiff: 150 })
        })

        it('[K04] KEEP_MAXDIFF 格式錯誤即拋錯(啟用時); 選項值優先於環境變數', async function() {
            for (let bad of ['abc', '-1', '1.5', '1e2']) {
                assert.throws(() => resolveKeepSame({ env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: bad } }), /E2E_BASELINE_KEEP_MAXDIFF 須為非負整數/)
            }
            assert.strict.deepStrictEqual(resolveKeepSame({ env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: ' 7 ' } }), { keepSame: true, keepMaxDiff: 7 })
            assert.strict.deepStrictEqual(resolveKeepSame({ env: { E2E_BASELINE_KEEP_SAME: '1' }, maxDiffPixels: 30 }), { keepSame: true, keepMaxDiff: 30 })
            assert.strict.deepStrictEqual(resolveKeepSame({ keepSame: false, env: { E2E_BASELINE_KEEP_SAME: '1' } }), { keepSame: false, keepMaxDiff: null })
            assert.strict.deepStrictEqual(resolveKeepSame({ keepSame: true, keepMaxDiff: 3, env: {} }), { keepSame: true, keepMaxDiff: 3 })
            assert.strict.deepStrictEqual(resolveKeepSame({ env: { E2E_BASELINE_KEEP_SAME: 'true' } }), { keepSame: false, keepMaxDiff: null })
            assert.throws(() => resolveKeepSame({ keepSame: true, keepMaxDiff: -1 }), /keepMaxDiff 須為非負整數/)
        })

        it('[K05] 啟用時: 標準圖不存在→寫(missing); 尺寸不同→寫(sizeChanged); 暫時狀態圖既有者不改寫(transient, 即使有變), 不存在者照寫', async function() {
            let env = { E2E_BASELINE_KEEP_SAME: '1' }
            let fpNew = fpOf('new')
            assert.strict.deepStrictEqual(await writeBaselineIfChanged(BASE, fpNew, { env }), { written: true, reason: 'missing', numDiff: null })
            let fp = seed('a')
            assert.strict.deepStrictEqual(await writeBaselineIfChanged(png(301, 200), fp, { env }), { written: true, reason: 'sizeChanged', numDiff: null })
            let fpT = seed('t')
            assert.strict.deepStrictEqual(await writeBaselineIfChanged(png(300, 200, 999), fpT, { env, transient: true }), { written: false, reason: 'transient', numDiff: null })
            assert.strict.equal(mtimeOf(fpT), OLD.getTime())
            assert.strict.equal((await writeBaselineIfChanged(BASE, fpOf('t2'), { env, transient: true })).reason, 'missing')
        })

        it('[K06] 比對端覆蓋(toCompare)只用於判定: 覆蓋後相同即保留; 寫出者為當次截圖本身; 判定對正式路徑、寫出落於 outPath', async function() {
            let env = { E2E_BASELINE_KEEP_SAME: '1' }
            let fp = seed('a')
            let cap = png(300, 200, 150)
            //模擬比對端以標準圖內容覆蓋不可固定之值: 直接回傳標準圖
            let toCompare = async (b, p) => fs.readFileSync(p)
            assert.strict.deepStrictEqual(await writeBaselineIfChanged(cap, fp, { env, toCompare }), { written: false, reason: 'same', numDiff: 0 })
            let fpOut = path.join(fdTmp, 'out', 'a.png')
            let r = await writeBaselineIfChanged(cap, fp, { env, outPath: fpOut })
            assert.strict.deepStrictEqual([r.written, fs.existsSync(fpOut), mtimeOf(fp)], [true, true, OLD.getTime()])
            assert.ok(fs.readFileSync(fpOut).equals(cap))
            await assert.rejects(writeBaselineIfChanged(cap, fp, { env, toCompare: async () => 'x' }), /toCompare 須回傳/)
        })

    })

    describe('runBaselineCase 之寫檔入口', function() {

        function fakeBrowser() {
            return {
                async newContext() {
                    return {
                        async newPage() {
                            return { on() {} }
                        }
                    }
                },
                async close() {},
            }
        }

        function caseOpt(logs, shots, over = {}) {
            return {
                mode: 'regen',
                lang: 'eng',
                name: 'E2E-001',
                launch: async () => fakeBrowser(),
                run: async () => shots,
                pathOf: (lang, k) => fpOf(`flow-${lang}-${k}`),
                log: (s) => logs.push(s),
                ...over,
            }
        }

        it('[K10] KEEP_SAME=1: 相同者 [keep] 且 mtime 不變、有變者 [write]、暫時狀態圖不改寫、缺者寫出; 回傳 kept／written', async function() {
            let fpA = seed('flow-eng-E2E-001-1-same')
            let fpB = seed('flow-eng-E2E-001-2-changed')
            let fpT = seed('flow-eng-E2E-001-3-toast')
            let logs = []
            let shots = { 'E2E-001-1-same': png(300, 200), 'E2E-001-2-changed': png(300, 200, 150), 'E2E-001-3-toast': png(300, 200, 500), 'E2E-001-4-new': BASE }
            let r = await runBaselineCase(caseOpt(logs, shots, { env: { E2E_BASELINE_KEEP_SAME: '1' }, transient: ['E2E-001-3-toast'] }))
            assert.strict.deepStrictEqual([r.written, r.kept], [['E2E-001-2-changed', 'E2E-001-4-new'], ['E2E-001-1-same', 'E2E-001-3-toast']])
            assert.strict.deepStrictEqual(logs, [
                '  [keep] eng-E2E-001-1-same (same)',
                '  [write] eng-E2E-001-2-changed (diff=150px)',
                '  [keep] eng-E2E-001-3-toast (transient)',
                '  [write] eng-E2E-001-4-new (missing)',
            ])
            assert.strict.deepStrictEqual([mtimeOf(fpA), mtimeOf(fpT)], [OLD.getTime(), OLD.getTime()])
            assert.notStrictEqual(mtimeOf(fpB), OLD.getTime())
        })

        it('[K11] 預設不變(env 未設): 相同者亦寫出、不讀標準圖、日誌同前版([write] 無原因); transient／compareBuf 不影響寫出', async function() {
            let fpA = seed('flow-eng-E2E-001-1-same')
            let logs = []
            let cmpCalls = 0
            let r = await runBaselineCase(caseOpt(logs, { 'E2E-001-1-same': BASE }, {
                env: {},
                transient: ['E2E-001-1-same'],
                compareBuf: async (b) => {
                    cmpCalls++
                    return b
                },
            }))
            assert.strict.deepStrictEqual([r.written, r.kept, logs, cmpCalls], [['E2E-001-1-same'], [], ['  [write] eng-E2E-001-1-same'], 0])
            assert.notStrictEqual(mtimeOf(fpA), OLD.getTime())
        })

        it('[K12] 配 gate: gate 決定寫者再經有變更才改寫, 原因合併印出; keep 亦算已產出(finalize 通過)', async function() {
            seed('flow-eng-E2E-001-1-same')
            seed('flow-eng-E2E-001-2-changed')
            let gate = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-001', stages: ['E2E-001-1-same', 'E2E-001-2-changed'] }], argv: ['node', 'x', '--names', 'E2E-001'], env: {}, log: null })
            let logs = []
            let shots = { 'E2E-001-1-same': BASE, 'E2E-001-2-changed': png(300, 200, 150) }
            await runBaselineCase(caseOpt(logs, shots, { gate, env: { E2E_BASELINE_KEEP_SAME: '1' } }))
            assert.strict.deepStrictEqual(logs, ['  [keep] eng-E2E-001-1-same (same)', '  [write] eng-E2E-001-2-changed (all; diff=150px)'])
            gate.finalize()
        })

        it('[K13] compareBuf 兩端共用: 產製端以之判定保留, 比對端以覆蓋後影像交 match(標準圖不存在時不呼叫)', async function() {
            seed('flow-eng-E2E-001-1-clock')
            let overlay = async (b, p) => fs.readFileSync(p)
            let logs = []
            let r = await runBaselineCase(caseOpt(logs, { 'E2E-001-1-clock': png(300, 200, 150) }, { env: { E2E_BASELINE_KEEP_SAME: '1' }, compareBuf: overlay }))
            assert.strict.deepStrictEqual(r.kept, ['E2E-001-1-clock'])
            let seen = []
            let cmpCalls = []
            await runBaselineCase(caseOpt([], { 'E2E-001-1-clock': png(300, 200, 150), 'E2E-001-9-none': BASE }, {
                mode: 'compare',
                env: {},
                compareBuf: async (b, p, ctx) => {
                    cmpCalls.push([path.basename(p), ctx.mode])
                    return fs.readFileSync(p)
                },
                match: (b, p) => seen.push([path.basename(p), b.equals(BASE)]),
            }))
            assert.strict.deepStrictEqual(cmpCalls, [['flow-eng-E2E-001-1-clock.png', 'compare']])
            assert.strict.deepStrictEqual(seen, [['flow-eng-E2E-001-1-clock.png', true], ['flow-eng-E2E-001-9-none.png', true]])
        })

        it('[K14] 產製端之組態錯誤於開瀏覽器前拋出; 比對端不讀 KEEP 環境變數', async function() {
            let launched = 0
            let launch = async () => {
                launched++
                return fakeBrowser()
            }
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: 'x' } })), /E2E_BASELINE_KEEP_MAXDIFF/)
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, transient: 'E2E-001-1-a' })), /transient 須為/)
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, compareBuf: 'x' })), /compareBuf 須為函數/)
            assert.strict.equal(launched, 0)
            let r = await runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { mode: 'compare', launch, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: 'x' }, match: () => {} }))
            assert.strict.equal(r.status, 'compare')
        })

        it('[K15] maxDiffPixels 選項同時為預設比對之容差與保留上限之預設(兩端一致)', async function() {
            let fp = seed('flow-eng-E2E-001-1-a')
            //比對端: 預設 match 以 maxDiffPixels=400 比對, 150px 通過(未逾一半不告警; 證據目錄以 pendingDir 導至 test/_tmp)
            let pend = path.join(fdTmp, 'pend')
            await runBaselineCase(caseOpt([], { 'E2E-001-1-a': png(300, 200, 150) }, { mode: 'compare', env: {}, maxDiffPixels: 400, pendingDir: pend }))
            assert.strict.equal(fs.existsSync(pend), false)
            //產製端: 保留上限預設同為 400
            let r = await runBaselineCase(caseOpt([], { 'E2E-001-1-a': png(300, 200, 150) }, { env: { E2E_BASELINE_KEEP_SAME: '1' }, maxDiffPixels: 400 }))
            assert.strict.deepStrictEqual([r.kept, mtimeOf(fp)], [['E2E-001-1-a'], OLD.getTime()])
        })

        it('[K16] 啟用時 --write-mode changed 之容差判定由有變更才改寫取代(外審 F12): KEEP_MAXDIFF=0 時 1px 差異照寫', async function() {
            let fp = seed('flow-eng-E2E-001-1-a')
            seed('flow-eng-E2E-001-2-b')
            let gate = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-001', stages: ['E2E-001-1-a', 'E2E-001-2-b'] }], argv: ['node', 'x', '--write-mode', 'changed'], env: {}, log: null })
            let logs = []
            let r = await runBaselineCase(caseOpt(logs, { 'E2E-001-1-a': png(300, 200, 1), 'E2E-001-2-b': BASE }, { gate, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: '0' } }))
            assert.strict.deepStrictEqual([r.written, r.kept], [['E2E-001-1-a'], ['E2E-001-2-b']])
            assert.strict.deepStrictEqual(logs, ['  [write] eng-E2E-001-1-a (changed→keepSame; diff=1px)', '  [keep] eng-E2E-001-2-b (same)'])
            assert.notStrictEqual(mtimeOf(fp), OLD.getTime())
            gate.finalize()
            //非零上限亦由 keepSame 決定: KEEP_MAXDIFF=10 時 50px 照寫(gate 之 100px 本會保留)
            seed('flow-eng-E2E-001-1-a')
            let gate3 = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-001', stages: ['E2E-001-1-a'] }], argv: ['node', 'x', '--write-mode', 'changed'], env: {}, log: null })
            let r3 = await runBaselineCase(caseOpt([], { 'E2E-001-1-a': png(300, 200, 50) }, { gate: gate3, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: '10' } }))
            assert.strict.deepStrictEqual(r3.written, ['E2E-001-1-a'])
            //未啟用時 changed 照舊(1px 在 100px 內保留)
            let fp2 = seed('flow-eng-E2E-001-1-a')
            let gate2 = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-001', stages: ['E2E-001-1-a'] }], argv: ['node', 'x', '--write-mode', 'changed'], env: {}, log: null })
            let r2 = await runBaselineCase(caseOpt([], { 'E2E-001-1-a': png(300, 200, 1) }, { gate: gate2, env: {} }))
            assert.strict.deepStrictEqual([r2.kept, mtimeOf(fp2)], [['E2E-001-1-a'], OLD.getTime()])
        })

        it('[K17] 啟用時配自訂 match 須明給容差(外審 F11): 未給即於開瀏覽器前拋錯; 給 maxDiffPixels 或 KEEP_MAXDIFF 即可', async function() {
            seed('flow-eng-E2E-001-1-a')
            let launched = 0
            let launch = async () => {
                launched++
                return fakeBrowser()
            }
            let match = () => {}
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, match, env: { E2E_BASELINE_KEEP_SAME: '1' } })), /自訂 match 時，須明給/)
            assert.strict.equal(launched, 0)
            let r1 = await runBaselineCase(caseOpt([], { 'E2E-001-1-a': png(300, 200, 1) }, { launch, match, maxDiffPixels: 0, env: { E2E_BASELINE_KEEP_SAME: '1' } }))
            assert.strict.deepStrictEqual(r1.written, ['E2E-001-1-a'])
            seed('flow-eng-E2E-001-1-a')
            let r2 = await runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, match, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: '0' } }))
            assert.strict.deepStrictEqual(r2.kept, ['E2E-001-1-a'])
            //未啟用時自訂 match 不受影響
            await runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, match, env: {} }))
            //null 與空字串同未給(複審 G6)
            let before = launched
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, match, keepMaxDiff: null, env: { E2E_BASELINE_KEEP_SAME: '1' } })), /自訂 match 時，須明給/)
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, match, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: '' } })), /自訂 match 時，須明給/)
            await assert.rejects(runBaselineCase(caseOpt([], { 'E2E-001-1-a': BASE }, { launch, match, env: { E2E_BASELINE_KEEP_SAME: '1', E2E_BASELINE_KEEP_MAXDIFF: null } })), /自訂 match 時，須明給/)
            assert.strict.equal(launched, before)
        })

        it('[K18] 預設不變: 未啟用時逐張同步寫出, 寫檔回呼排入之微工作於全部寫完後才執行(時序同 1.0.10; 外審 F9)', async function() {
            let order = []
            let writeFile = (p) => {
                let k = path.basename(p, '.png').slice(-1)
                order.push(`write:${k}`)
                Promise.resolve().then(() => order.push(`micro:${k}`))
            }
            await runBaselineCase(caseOpt({ push: (s) => order.push(s) }, { 'E2E-001-1-a': BASE, 'E2E-001-2-b': BASE }, { env: {}, writeFile, log: (s) => order.push(s.trim()) }))
            assert.strict.deepStrictEqual(order.slice(0, 6), ['write:a', '[write] eng-E2E-001-1-a', 'write:b', '[write] eng-E2E-001-2-b', 'micro:a', 'micro:b'])
        })

    })

})
