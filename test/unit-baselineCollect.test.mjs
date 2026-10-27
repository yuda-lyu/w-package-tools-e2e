import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { PNG } from 'pngjs'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'
import createBaselineCollector, { activeBaselineCollector } from '../src/createBaselineCollector.mjs'
import runBaselineCase from '../src/runBaselineCase.mjs'
import getE2eMode from '../src/getE2eMode.mjs'
import createKnownDefect from '../src/createKnownDefect.mjs'


//收集模式(Gitea issue #19 第1項)之單元測試: 預設不變(範圍外/未啟用照常首張不符即拋)、收集與彙整錯誤之固定格式、語意失敗之呈現、
//runBaselineCase 之收集(run 內逐階段與案例末比對)、已知缺陷、與產製互斥; 中介資料落 ./test/_tmp/baselineCollect, 測完刪除


let fdTmp = path.resolve('./test/_tmp/baselineCollect')
let fdPending = path.join(fdTmp, 'testPending')
let fdPics = path.join(fdTmp, 'pics')

//純色圖, 另把 dots 個像素改黑(每列至多 100 個, 確保為真不同而非反鋸齒)
function png(w, h, dots = 0) {
    let p = new PNG({ width: w, height: h })
    for (let i = 0; i < w * h; i++) {
        p.data[i * 4] = 250
        p.data[i * 4 + 1] = 250
        p.data[i * 4 + 2] = 250
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
let picOf = (k) => path.join(fdPics, `flow-eng-${k}.png`)
let listPending = () => (fs.existsSync(fdPending) ? fs.readdirSync(fdPending).sort() : [])
//專案根之 ./testPending(預設證據目錄): 本檔不得寫入(測試一律導至 test/_tmp)
let fdRootPending = path.resolve('./testPending')
let listRootPending = () => (fs.existsSync(fdRootPending) ? fs.readdirSync(fdRootPending).sort() : [])
let clearPending = () => fs.rmSync(fdPending, { recursive: true, force: true })
let abm = (buf, k, o = {}) => assertBaselineMatch(buf, picOf(k), `flow-eng-${k}`, { pendingDir: fdPending, ...o })

//假瀏覽器(同 unit-runBaselineCase): 記錄 close
function fakeBrowser(log) {
    return {
        async newContext() {
            return {
                async newPage() {
                    return { on() {} }
                }
            }
        },
        async close() {
            log.push('close')
        },
    }
}


describe('收集模式(collect)', function() {

    let rootPendingBefore = []

    before(function() {
        rootPendingBefore = listRootPending()
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdPics, { recursive: true })
        for (let k of ['E2E-009-1-a', 'E2E-009-2-b', 'E2E-009-3-c', 'E2E-009-4-d']) {
            fs.writeFileSync(picOf(k), BASE)
        }
    })

    afterEach(function() {
        clearPending()
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
        //守門: 本檔之任何案例不得把證據或案例清單寫到專案根之 ./testPending
        assert.strict.deepStrictEqual(listRootPending().filter((f) => !rootPendingBefore.includes(f)), [])
    })

    describe('assertBaselineMatch 與 createBaselineCollector', function() {

        it('[C01] 預設不變: 收集器範圍外即使 E2E_COLLECT=1 仍首張不符即拋原訊息、缺標準圖拋原訊息且不存證據、通過回傳 undefined(防無人彙整之假綠)', function() {
            let saved = process.env.E2E_COLLECT
            process.env.E2E_COLLECT = '1'
            try {
                assert.strict.equal(activeBaselineCollector(), null)
                assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a'), /^Error: 截圖與標準圖不一致 \(diff=150px > maxDiffPixels=100\): flow-eng-E2E-009-1-a — capture\/baseline\/diff 已存 .+__\*\.png 供 diff$/)
                assert.strict.deepStrictEqual(listPending().length, 3)
                clearPending()
                assert.throws(() => abm(BASE, 'E2E-404-x'), /^Error: 標準圖不存在: .+flow-eng-E2E-404-x\.png \(請先執行對應 e2e --baseline 產製\)$/)
                assert.strict.deepStrictEqual(listPending(), [])
                assert.strict.equal(abm(BASE, 'E2E-009-1-a'), undefined)
            }
            finally {
                if (saved === undefined) {
                    delete process.env.E2E_COLLECT
                }
                else {
                    process.env.E2E_COLLECT = saved
                }
            }
        })

        it('[C02] 預設不變: 範圍內之收集器未啟用(E2E_COLLECT 未設)時照常首張不符即拋, 範圍外收集器不殘留', async function() {
            let col = createBaselineCollector({ caseKey: 'flow-eng-E2E-009', env: {} })
            assert.strict.equal(col.enabled, false)
            let after1 = false
            await assert.rejects(col.run(async () => {
                abm(png(300, 200, 150), 'E2E-009-1-a')
                after1 = true
            }), /截圖與標準圖不一致 \(diff=150px/)
            assert.strict.equal(after1, false)
            assert.strict.equal(activeBaselineCollector(), null)
        })

        it('[C03] 啟用: 不符不拋改記錄並續行, 證據照存(缺標準圖存 capture 為候選), 案例末拋固定格式之彙整錯誤並附每一階段狀態與案例清單', async function() {
            let col = createBaselineCollector({ caseKey: 'flow-eng-E2E-009', env: { E2E_COLLECT: '1' }, log: () => {} })
            let seen = []
            let err = null
            try {
                await col.run(async () => {
                    seen.push(abm(png(300, 200, 150), 'E2E-009-1-a').status)
                    seen.push(abm(BASE, 'E2E-009-2-b').status)
                    await new Promise((resolve) => setTimeout(resolve, 5))
                    seen.push(abm(BASE, 'E2E-009-9-new').status)
                    seen.push(abm(png(301, 200), 'E2E-009-3-c').status)
                })
            }
            catch (e) {
                err = e
            }
            assert.strict.deepStrictEqual(seen, ['diff', 'pass', 'missing', 'size'])
            assert.ok(err, '應拋彙整錯誤')
            let lines = err.message.split('\n')
            assert.strict.equal(lines[0], '截圖與標準圖不一致 ×3/4 [flow-eng-E2E-009]: flow-eng-E2E-009-1-a(150px), flow-eng-E2E-009-9-new(缺標準圖), flow-eng-E2E-009-3-c(尺寸不同)')
            assert.match(lines[1], /^ {2}- flow-eng-E2E-009-1-a: diff=150px > maxDiffPixels=100 → .+flow-eng-E2E-009-1-a__[\d_-]+__\{capture,baseline,diff\}\.png$/)
            assert.match(lines[2], /^ {2}- flow-eng-E2E-009-9-new: 標準圖不存在 .+flow-eng-E2E-009-9-new\.png → .+__capture\.png\(候選標準圖\)$/)
            assert.match(lines[3], /^ {2}- flow-eng-E2E-009-3-c: 尺寸不同 cap=301x200 base=300x200 → .+__\{capture,baseline\}\.png$/)
            assert.match(lines[4], /^ {2}\(案例清單 .+flow-eng-E2E-009__[\d_-]+__collect\.json\)$/)
            //首行可依固定格式解析出每張之狀態
            let m = lines[0].match(/^截圖與標準圖不一致 ×(\d+)\/(\d+) \[([^\]]*)\]: (.*)$/)
            let items = [...m[4].matchAll(/([\w.-]+)\(([^)]*)\)/g)].map((x) => [x[1], x[2]])
            assert.strict.deepStrictEqual([m[1], m[2], m[3]], ['3', '4', 'flow-eng-E2E-009'])
            assert.strict.deepStrictEqual(items, [['flow-eng-E2E-009-1-a', '150px'], ['flow-eng-E2E-009-9-new', '缺標準圖'], ['flow-eng-E2E-009-3-c', '尺寸不同']])
            //每一階段之狀態(含通過者)
            assert.strict.deepStrictEqual(err.baselineCollect.records.map((r) => [r.label, r.status, r.numDiff]), [
                ['flow-eng-E2E-009-1-a', 'diff', 150], ['flow-eng-E2E-009-2-b', 'pass', 0], ['flow-eng-E2E-009-9-new', 'missing', null], ['flow-eng-E2E-009-3-c', 'size', null],
            ])
            //證據: diff 三聯組、缺標準圖只 capture、尺寸不同 capture+baseline、案例清單一份
            let fsP = listPending()
            let kinds = (lab) => fsP.filter((f) => f.startsWith(`${lab}__`)).map((f) => f.replace(/^.*__/, '')).sort()
            assert.strict.deepStrictEqual(kinds('flow-eng-E2E-009-1-a'), ['baseline.png', 'capture.png', 'diff.png'])
            assert.strict.deepStrictEqual(kinds('flow-eng-E2E-009-9-new'), ['capture.png'])
            assert.strict.deepStrictEqual(kinds('flow-eng-E2E-009-3-c'), ['baseline.png', 'capture.png'])
            assert.strict.deepStrictEqual(kinds('flow-eng-E2E-009-2-b'), [])
            let mf = fsP.filter((f) => f.endsWith('__collect.json'))
            assert.strict.equal(mf.length, 1)
            let data = JSON.parse(fs.readFileSync(path.join(fdPending, mf[0]), 'utf8'))
            assert.strict.deepStrictEqual([data.caseKey, data.outcome, data.error, data.records.length], ['flow-eng-E2E-009', 'mismatch', null, 4])
            assert.ok(fs.readFileSync(`${data.records[2].stem}__capture.png`).equals(BASE))
            //彙整後清空, 收集器可續用; 不寫回標準圖
            assert.strict.equal(col.records.length, 0)
            assert.ok(fs.readFileSync(picOf('E2E-009-1-a')).equals(BASE))
            assert.strict.equal(fs.existsSync(picOf('E2E-009-9-new')), false)
        })

        it('[C04] 啟用而案例因其他錯誤(語意斷言)失敗: 該錯誤原樣拋出(同一物件、訊息不變), 已收集之不符另印一行並掛 baselineCollect, 案例清單 outcome=failed', async function() {
            let logs = []
            let col = createBaselineCollector({ caseKey: 'flow-eng-E2E-009', enabled: true, log: (s) => logs.push(s) })
            let semErr = new assert.AssertionError({ message: '語意: 應顯示「已儲存」', actual: 'x', expected: 'y' })
            let got = null
            try {
                await col.run(async () => {
                    abm(png(300, 200, 150), 'E2E-009-1-a')
                    throw semErr
                })
            }
            catch (e) {
                got = e
            }
            assert.strict.equal(got, semErr)
            assert.strict.equal(got.message, '語意: 應顯示「已儲存」')
            assert.strict.deepStrictEqual(logs, ['[baseline-collect] 截圖與標準圖不一致 ×1/1 [flow-eng-E2E-009]: flow-eng-E2E-009-1-a(150px) (案例另因錯誤失敗, 以該錯誤為準)'])
            assert.strict.deepStrictEqual(got.baselineCollect.records.map((r) => r.status), ['diff'])
            let mf = listPending().filter((f) => f.endsWith('__collect.json'))
            let data = JSON.parse(fs.readFileSync(path.join(fdPending, mf[0]), 'utf8'))
            assert.strict.deepStrictEqual([data.outcome, data.error], ['failed', '語意: 應顯示「已儲存」'])
        })

        it('[C05] 啟用而全部一致: 回傳 fn 之值, 不拋、不寫證據與清單、不印日誌', async function() {
            let logs = []
            let col = createBaselineCollector({ caseKey: 'k', enabled: true, log: (s) => logs.push(s) })
            let r = await col.run(async () => {
                abm(BASE, 'E2E-009-1-a')
                abm(png(300, 200, 40), 'E2E-009-2-b', { warn: () => {} })
                return 'ok'
            })
            assert.strict.equal(r, 'ok')
            assert.strict.deepStrictEqual([listPending(), logs], [[], []])
        })

        it('[C06] opt.collect: false 於範圍內仍拋; 收集器物件須啟用且在其 run 期間才收集(範圍外傳入即照常拋, 外審 F1); true 用作用中之收集器(不論 enabled)', async function() {
            let on = createBaselineCollector({ caseKey: 'on', enabled: true, log: () => {} })
            let off = createBaselineCollector({ caseKey: 'off', enabled: false })
            let other = createBaselineCollector({ caseKey: 'other', enabled: true, log: () => {} })
            await on.run(async () => {
                assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a', { collect: false }), /截圖與標準圖不一致/)
                //範圍內傳入另一個未在 run 期間之收集器物件: 照常拋, 不記到無人彙整之物件
                assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a', { collect: other }), /截圖與標準圖不一致 \(diff/)
            })
            assert.strict.equal(other.records.length, 0)
            //範圍外傳入收集器物件(未呼叫其 run): 照常拋
            assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a', { collect: on }), /截圖與標準圖不一致 \(diff/)
            assert.strict.equal(on.records.length, 0)
            await assert.rejects(on.run(async () => {
                assert.strict.equal(abm(png(300, 200, 150), 'E2E-009-1-a', { collect: on }).status, 'diff')
            }), /^Error: 截圖與標準圖不一致 ×1\/1 \[on\]/)
            await off.run(async () => {
                assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a', { collect: off }), /截圖與標準圖不一致/)
            })
            await assert.rejects(off.run(async () => {
                assert.strict.equal(abm(png(300, 200, 150), 'E2E-009-1-a', { collect: true }).status, 'diff')
            }), /^Error: 截圖與標準圖不一致 ×1\/1 \[off\]/)
            assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a', { collect: true }), /截圖與標準圖不一致 \(diff/)
        })

        it('[C17] run 結束後遺留之非同步工作不再收集(外審 F2): 其比對照常立即拋錯, 收集器無殘留紀錄', async function() {
            let col = createBaselineCollector({ caseKey: 'late', enabled: true, log: () => {} })
            let late = null
            let done = new Promise((resolve) => {
                col.run(async () => {
                    setTimeout(() => {
                        try {
                            abm(png(300, 200, 150), 'E2E-009-1-a')
                            late = 'recorded'
                        }
                        catch (e) {
                            late = 'thrown'
                        }
                        resolve()
                    }, 20)
                    return 'ok'
                }).then((r) => assert.strict.equal(r, 'ok'))
            })
            await done
            assert.strict.deepStrictEqual([late, col.records.length, col.open], ['thrown', 0, false])
        })

        it('[C18] 收集範圍內巢狀之案例(外審 F3): 產製端於開瀏覽器前拋錯(互斥, 標準圖不動); 未啟用收集之比對端遮蔽外層, 照常首張不符即拋', async function() {
            let outer = createBaselineCollector({ caseKey: 'outer', enabled: true, log: () => {} })
            let launched = 0
            let written = []
            let mk = (over) => ({
                lang: 'eng',
                name: 'E2E-009',
                launch: async () => {
                    launched++
                    return fakeBrowser([])
                },
                pathOf: (lang, k) => picOf(k),
                labelOf: (lang, k) => `flow-${lang}-${k}`,
                match: (b, p, l) => assertBaselineMatch(b, p, l, { pendingDir: fdPending }),
                writeFile: (p) => written.push(p),
                log: () => {},
                env: {},
                ...over,
            })
            let innerErr = null
            await outer.run(async () => {
                await assert.rejects(runBaselineCase(mk({ mode: 'regen', collect: false, run: async () => ({ 'E2E-009-1-a': BASE }) })), /互斥/)
                innerErr = await runBaselineCase(mk({
                    mode: 'compare',
                    collect: false,
                    run: async () => {
                        abm(png(300, 200, 150), 'E2E-009-1-a')
                        return { 'E2E-009-2-b': BASE }
                    }
                })).then(() => null, (e) => e)
            })
            assert.strict.deepStrictEqual([launched, written], [1, []])
            assert.match(innerErr.message, /^截圖與標準圖不一致 \(diff=150px/)
            assert.strict.equal(outer.records.length, 0)
        })

        it('[C21] 收集模式下之餘裕告警照常印出, 並記一筆 pass(含 numDiff)(外審 F7)', async function() {
            let warns = []
            let col = createBaselineCollector({ caseKey: 'h', enabled: true, log: () => {} })
            let rec = null
            await col.run(async () => {
                rec = abm(png(300, 200, 60), 'E2E-009-1-a', { warn: (s) => warns.push(s) })
                abm(png(300, 200, 40), 'E2E-009-2-b', { warn: (s) => warns.push(s) })
            })
            assert.strict.deepStrictEqual([rec.status, rec.numDiff, warns.length], ['pass', 60, 1])
            assert.match(warns[0], /^\[baseline-headroom\] flow-eng-E2E-009-1-a: 通過但 diff=60px/)
        })

        it('[C20] 日誌或案例清單本身失敗不取代原錯誤(外審 F5): 原錯誤原樣拋出並記 sideErrors; 彙整時清單寫入失敗仍拋彙整錯誤並註明', async function() {
            let col = createBaselineCollector({
                caseKey: 'side',
                enabled: true,
                log: () => {
                    throw new Error('log failure')
                }
            })
            let semErr = new Error('semantic failure')
            let got = await col.run(async () => {
                abm(png(300, 200, 150), 'E2E-009-1-a')
                throw semErr
            }).then(() => null, (e) => e)
            assert.strict.equal(got, semErr)
            assert.strict.deepStrictEqual(got.baselineCollect.sideErrors, ['日誌失敗: log failure'])
            assert.strict.equal(col.records.length, 0)
            //清單目錄為檔案 → 寫入失敗
            let fpFile = path.join(fdTmp, 'notadir')
            fs.writeFileSync(fpFile, 'x')
            let col2 = createBaselineCollector({ caseKey: 'side2', enabled: true, log: () => {} })
            let agg = await col2.run(async () => {
                col2.add({ label: 'x', status: 'diff', numDiff: 1, maxDiffPixels: 0, stem: path.join(fpFile, 'x') })
            }).then(() => null, (e) => e)
            assert.match(agg.message, /^截圖與標準圖不一致 ×1\/1 \[side2\]: x\(1px\)/)
            assert.match(agg.message, /\(案例清單寫入失敗: /)
            fs.rmSync(fpFile)
        })

        it('[C25] 缺標準圖而當次截圖不是可解碼之 PNG(外審 F17): 照常拋解碼錯誤, 不存成候選', async function() {
            let col = createBaselineCollector({ caseKey: 'bad', enabled: true, log: () => {} })
            await assert.rejects(col.run(async () => {
                abm(Buffer.from('not a png'), 'E2E-404-x')
            }), (e) => !/截圖與標準圖不一致/.test(e.message))
            assert.strict.deepStrictEqual(listPending(), [])
        })

        it('[C28] 證據檔名以排他建立保留(外審 F16): 存在檢查之後他行程才建立同名 capture 時改用 -N, 不共用同一組', async function() {
            let ts = '2026-09-27_12-34-56-789'
            let RealDate = Date
            let fixed = new RealDate('2026-09-27T12:34:56.789Z').getTime()
            global.Date = class extends RealDate {
                constructor(...a) {
                    super(...(a.length ? a : [fixed]))
                }

                static now() {
                    return fixed
                }
            }
            let realExists = fs.existsSync
            fs.mkdirSync(fdPending, { recursive: true })
            let racer = path.join(fdPending, `flow-eng-E2E-009-1-a__${ts}__capture.png`)
            //模擬競態: 存在檢查回報不存在, 但檔已被他行程建立
            fs.writeFileSync(racer, 'other-process')
            fs.existsSync = (p) => (String(p).replace(/\\/g, '/') === racer.replace(/\\/g, '/') ? false : realExists(p))
            try {
                assert.throws(() => abm(png(300, 200, 150), 'E2E-009-1-a'), new RegExp(`__${ts}-1__\\*\\.png 供 diff`))
            }
            finally {
                fs.existsSync = realExists
                global.Date = RealDate
            }
            assert.strict.equal(fs.readFileSync(racer, 'utf8'), 'other-process')
            assert.strict.deepStrictEqual(listPending().filter((f) => f.includes(`${ts}-1__`)).length, 3)
        })

        it('[C07] 以非同步脈絡界定範圍: 兩案例並行交錯 await 仍各自記入自己的收集器', async function() {
            let a = createBaselineCollector({ caseKey: 'A', enabled: true, log: () => {} })
            let b = createBaselineCollector({ caseKey: 'B', enabled: true, log: () => {} })
            let tick = () => new Promise((resolve) => setTimeout(resolve, 3))
            let ra = a.run(async () => {
                await tick()
                abm(png(300, 200, 150), 'E2E-009-1-a')
                await tick()
                abm(BASE, 'E2E-009-2-b')
            })
            let rb = b.run(async () => {
                abm(BASE, 'E2E-009-3-c')
                await tick()
                await tick()
                abm(png(300, 200, 200), 'E2E-009-4-d')
            })
            let [ea, eb] = await Promise.allSettled([ra, rb])
            assert.match(ea.reason.message, /^截圖與標準圖不一致 ×1\/2 \[A\]: flow-eng-E2E-009-1-a\(150px\)\n/)
            assert.match(eb.reason.message, /^截圖與標準圖不一致 ×1\/2 \[B\]: flow-eng-E2E-009-4-d\(200px\)\n/)
        })

    })

    describe('getE2eMode 之互斥閘門', function() {

        it('[C08] regen 且 E2E_COLLECT=1 即拋錯(guard:false 可關); 非 regen 時回傳物件形狀不變', function() {
            assert.throws(() => getE2eMode({ argv: ['--baseline'], env: { E2E_COLLECT: '1' } }), /收集模式.*互斥/)
            assert.throws(() => getE2eMode({ argv: [], env: { E2E_REGEN: '1', E2E_COLLECT: '1' } }), /互斥/)
            assert.strict.deepStrictEqual(getE2eMode({ argv: ['--baseline'], env: { E2E_COLLECT: '1' }, guard: false }), { regen: true, diag: false, strictCapture: false })
            assert.strict.deepStrictEqual(getE2eMode({ argv: [], env: { E2E_COLLECT: '1' } }), { regen: false, diag: false, strictCapture: false })
            assert.strict.deepStrictEqual(getE2eMode({ argv: ['--baseline'], env: { E2E_COLLECT: '0' } }), { regen: true, diag: false, strictCapture: false })
        })

    })

    describe('runBaselineCase 之收集模式', function() {

        //run 內逐階段比對 1 張(inline), 回傳 2 張交案例末比對
        function caseOpt(log, over = {}) {
            return {
                mode: 'compare',
                lang: 'eng',
                name: 'E2E-009',
                launch: async () => fakeBrowser(log),
                run: async () => {
                    abm(png(300, 200, 150), 'E2E-009-1-a')
                    log.push('after-stage1')
                    return { 'E2E-009-2-b': png(300, 200, 300), 'E2E-009-3-c': BASE }
                },
                pathOf: (lang, k) => picOf(k),
                labelOf: (lang, k) => `flow-${lang}-${k}`,
                match: (b, p, l) => assertBaselineMatch(b, p, l, { pendingDir: fdPending }),
                afterCase: async () => log.push('afterCase'),
                log: (s) => log.push(s),
                ...over,
            }
        }

        it('[C10] E2E_COLLECT=1: run 內不符續拍、案例末逐張比完, 關瀏覽器與 afterCase 之後才拋彙整錯誤', async function() {
            let log = []
            let err = await runBaselineCase(caseOpt(log, { env: { E2E_COLLECT: '1' } })).then(() => null, (e) => e)
            assert.ok(err)
            assert.strict.equal(err.message.split('\n')[0], '截圖與標準圖不一致 ×2/3 [eng-E2E-009]: flow-eng-E2E-009-1-a(150px), flow-eng-E2E-009-2-b(300px)')
            assert.strict.deepStrictEqual(log, ['after-stage1', 'close', 'afterCase'])
            assert.strict.deepStrictEqual(err.baselineCollect.records.map((r) => [r.label, r.status]), [
                ['flow-eng-E2E-009-1-a', 'diff'], ['flow-eng-E2E-009-2-b', 'diff'], ['flow-eng-E2E-009-3-c', 'pass'],
            ])
            assert.strict.equal(listPending().filter((f) => f.endsWith('__collect.json')).length, 1)
        })

        it('[C16] 預設不變(env 未設、未給 collect): run 內首張不符即拋並中止(後續階段不拍), 案例末首張不符即拋', async function() {
            let log = []
            await assert.rejects(runBaselineCase(caseOpt(log, { env: {} })), /^Error: 截圖與標準圖不一致 \(diff=150px > maxDiffPixels=100\): flow-eng-E2E-009-1-a/)
            assert.strict.deepStrictEqual(log, ['close', 'afterCase'])
            clearPending()
            let calls = []
            let log2 = []
            let o = caseOpt(log2, {
                env: {},
                run: async () => ({ 'E2E-009-2-b': png(300, 200, 300), 'E2E-009-3-c': png(300, 200, 300) }),
                match: (b, p, l) => {
                    calls.push(l)
                    return assertBaselineMatch(b, p, l, { pendingDir: fdPending })
                },
            })
            await assert.rejects(runBaselineCase(o), /diff=300px/)
            assert.strict.deepStrictEqual(calls, ['flow-eng-E2E-009-2-b'])
        })

        it('[C11] 收集模式而語意斷言失敗: 以語意錯誤為準原樣拋出、不做案例末比對, run 內已收集之不符另印 [baseline-collect]', async function() {
            let log = []
            let semErr = new Error('語意: 表格應有 3 列')
            let matched = []
            let o = caseOpt(log, {
                collect: true,
                semantic: async () => {
                    throw semErr
                },
                match: (b, p, l) => matched.push(l),
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.strict.equal(err, semErr)
            assert.strict.deepStrictEqual(matched, [])
            assert.ok(log.includes('[baseline-collect] 截圖與標準圖不一致 ×1/1 [eng-E2E-009]: flow-eng-E2E-009-1-a(150px) (案例另因錯誤失敗, 以該錯誤為準)'))
            assert.strict.deepStrictEqual(err.baselineCollect.records.map((r) => r.status), ['diff'])
        })

        it('[C12] 收集模式之整案已知缺陷: run 內已收集不符即改拋彙整錯誤、不呼叫 onKnownDefect; 無不符才 onKnownDefect', async function() {
            let calls = 0
            let o = caseOpt([], {
                collect: true,
                run: async () => {
                    abm(png(300, 200, 150), 'E2E-009-1-a')
                    throw createKnownDefect('第2步空白表格', { ref: 'spec 已知落差' })
                },
                onKnownDefect: async () => {
                    calls++
                },
            })
            await assert.rejects(runBaselineCase(o), /^Error: 截圖與標準圖不一致 ×1\/1 \[eng-E2E-009\]/)
            assert.strict.equal(calls, 0)
            let o2 = caseOpt([], {
                collect: true,
                run: async () => {
                    abm(BASE, 'E2E-009-1-a')
                    throw createKnownDefect('第2步空白表格')
                },
                onKnownDefect: async () => {
                    calls++
                },
            })
            await assert.rejects(runBaselineCase(o2), (e) => e.knownDefect === true)
            assert.strict.equal(calls, 1)
        })

        it('[C13] 收集模式之部分已知缺陷: 前段任一張不符即拋彙整錯誤(列出前段全部不符), 不呼叫 onKnownDefect', async function() {
            let calls = 0
            let o = caseOpt([], {
                collect: true,
                stages: ['E2E-009-1-a', 'E2E-009-2-b', 'E2E-009-4-d'],
                defectStages: ['E2E-009-4-d'],
                run: async () => {
                    throw createKnownDefect('第4步', { shots: { 'E2E-009-1-a': png(300, 200, 120), 'E2E-009-2-b': png(300, 200, 130) } })
                },
                onKnownDefect: async () => {
                    calls++
                },
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.strict.equal(err.message.split('\n')[0], '截圖與標準圖不一致 ×2/2 [eng-E2E-009]: flow-eng-E2E-009-1-a(120px), flow-eng-E2E-009-2-b(130px)')
            assert.strict.equal(calls, 0)
        })

        it('[C14] 收集模式與產製互斥: regen 配 collect 或 E2E_COLLECT=1 於開瀏覽器前拋錯', async function() {
            let launched = 0
            let o = (over) => caseOpt([], {
                mode: 'regen',
                launch: async () => {
                    launched++
                    return fakeBrowser([])
                },
                ...over
            })
            await assert.rejects(runBaselineCase(o({ collect: true })), /收集模式.*互斥/)
            await assert.rejects(runBaselineCase(o({ env: { E2E_COLLECT: '1' } })), /互斥/)
            assert.strict.equal(launched, 0)
        })

        it('[C15] 收集模式下比對函數拋出之其他錯誤記為「比對錯誤」並續比其餘各張', async function() {
            let calls = []
            let o = caseOpt([], {
                collect: true,
                run: async () => ({ 'E2E-009-2-b': BASE, 'E2E-009-3-c': png(300, 200, 150) }),
                match: (b, p, l) => {
                    calls.push(l)
                    if (l.endsWith('2-b')) {
                        throw new Error('覆蓋區量測失敗 (overlay)')
                    }
                    return assertBaselineMatch(b, p, l, { pendingDir: fdPending })
                },
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.strict.deepStrictEqual(calls, ['flow-eng-E2E-009-2-b', 'flow-eng-E2E-009-3-c'])
            let lines = err.message.split('\n')
            assert.strict.equal(lines[0], '截圖與標準圖不一致 ×2/2 [eng-E2E-009]: flow-eng-E2E-009-2-b(比對錯誤), flow-eng-E2E-009-3-c(150px)')
            assert.strict.equal(lines[1], '  - flow-eng-E2E-009-2-b: 覆蓋區量測失敗 (overlay)')
            //有比對錯誤之案例清單為 failed(其餘證據亦不可採用; 外審 F13)
            let mf = listPending().filter((f) => f.endsWith('__collect.json'))
            let data = JSON.parse(fs.readFileSync(path.join(fdPending, mf[0]), 'utf8'))
            assert.strict.deepStrictEqual([data.outcome, data.error], ['failed', '覆蓋區量測失敗 (overlay)'])
        })

        it('[C19] 已知缺陷而已收集不符(外審 F4): 收尾成功時於 afterCase 之後拋彙整(清單 mismatch); afterCase 另拋錯時以之為準、清單 failed、紀錄掛於該錯誤', async function() {
            let mkDefect = (log, afterCase) => caseOpt(log, {
                collect: true,
                run: async () => {
                    abm(png(300, 200, 150), 'E2E-009-1-a')
                    throw createKnownDefect('第2步空白表格')
                },
                onKnownDefect: async () => log.push('onKnownDefect'),
                afterCase,
            })
            let log = []
            let err = await runBaselineCase(mkDefect(log, async () => log.push('afterCase'))).then(() => null, (e) => e)
            assert.match(err.message, /^截圖與標準圖不一致 ×1\/1 \[eng-E2E-009\]/)
            assert.strict.deepStrictEqual(log, ['close', 'afterCase'])
            let outcomes = () => listPending().filter((f) => f.endsWith('__collect.json')).map((f) => JSON.parse(fs.readFileSync(path.join(fdPending, f), 'utf8')).outcome)
            assert.strict.deepStrictEqual(outcomes(), ['mismatch'])
            clearPending()
            let acErr = new Error('afterCase failed')
            let err2 = await runBaselineCase(mkDefect([], async () => {
                throw acErr
            })).then(() => null, (e) => e)
            assert.strict.equal(err2, acErr)
            assert.strict.deepStrictEqual(err2.baselineCollect.records.map((r) => r.status), ['diff'])
            assert.strict.deepStrictEqual(outcomes(), ['failed'])
        })

        it('[C22] 自訂 match 正常回傳(未經 assertBaselineMatch)者補記 pass, 彙整分母為實際比對張數(外審 F10); 全無證據檔時清單落 pendingDir', async function() {
            let o = caseOpt([], {
                collect: true,
                pendingDir: fdPending,
                run: async () => ({ 'E2E-009-2-b': BASE, 'E2E-009-3-c': BASE }),
                match: (b, p, l) => {
                    if (l.endsWith('3-c')) {
                        throw new Error('bad')
                    }
                },
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.match(err.message, /^截圖與標準圖不一致 ×1\/2 \[eng-E2E-009\]: flow-eng-E2E-009-3-c\(比對錯誤\)$/m)
            assert.strict.deepStrictEqual(err.baselineCollect.records.map((r) => [r.label, r.status]), [['flow-eng-E2E-009-2-b', 'pass'], ['flow-eng-E2E-009-3-c', 'error']])
            assert.strict.equal(listPending().filter((f) => f.endsWith('__collect.json')).length, 1)
        })

        it('[C24] 證據分落多個目錄時, 每個目錄各寫一份案例清單(外審 F14)', async function() {
            let fdP2 = path.join(fdTmp, 'testPending2')
            let o = caseOpt([], {
                collect: true,
                run: async () => ({ 'E2E-009-2-b': png(300, 200, 150), 'E2E-009-3-c': png(300, 200, 150) }),
                match: (b, p, l) => assertBaselineMatch(b, p, l, { pendingDir: l.endsWith('3-c') ? fdP2 : fdPending }),
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.match(err.message, /\(案例清單 .+; .+\)/)
            for (let d of [fdPending, fdP2]) {
                assert.strict.equal(fs.readdirSync(d).filter((f) => f.endsWith('__collect.json')).length, 1)
            }
            fs.rmSync(fdP2, { recursive: true, force: true })
        })

        it('[C26] runBaselineCase 之 pendingDir 傳給預設比對(外審 F19): 證據與清單落於指定目錄', async function() {
            let fdP3 = path.join(fdTmp, 'pending3')
            let o = caseOpt([], { collect: true, pendingDir: fdP3, run: async () => ({ 'E2E-009-2-b': png(300, 200, 150) }) })
            delete o.match
            await assert.rejects(runBaselineCase(o), /×1\/1/)
            let fsP = fs.readdirSync(fdP3)
            assert.strict.deepStrictEqual([fsP.filter((f) => f.endsWith('.png')).length, fsP.filter((f) => f.endsWith('__collect.json')).length], [3, 1])
            assert.strict.equal(fs.existsSync(path.resolve('./testPending')) && fs.readdirSync(path.resolve('./testPending')).some((f) => f.startsWith('flow-eng-E2E-009-2-b__')), false)
            fs.rmSync(fdP3, { recursive: true, force: true })
        })

        it('[C27] 收集模式下 pathOf／labelOf 拋錯記為比對錯誤(標籤退用 <lang>-<圖鍵>)並續比其餘各張(外審 F22)', async function() {
            let o = caseOpt([], {
                collect: true,
                run: async () => ({ 'E2E-009-2-b': BASE, 'E2E-009-3-c': png(300, 200, 150) }),
                pathOf: (lang, k) => {
                    if (k.endsWith('2-b')) {
                        throw new Error('path failed')
                    }
                    return picOf(k)
                },
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.strict.equal(err.message.split('\n')[0], '截圖與標準圖不一致 ×2/2 [eng-E2E-009]: eng-E2E-009-2-b(比對錯誤), flow-eng-E2E-009-3-c(150px)')
            //labelOf 自身拋錯亦同; 每張只呼叫一次 labelOf(複審 G14)
            let calls = []
            let o2 = caseOpt([], {
                collect: true,
                run: async () => ({ 'E2E-009-2-b': BASE, 'E2E-009-3-c': png(300, 200, 150) }),
                labelOf: (lang, k) => {
                    calls.push(k)
                    if (k.endsWith('2-b')) {
                        throw new Error('label failed')
                    }
                    return `flow-${lang}-${k}`
                },
            })
            let err2 = await runBaselineCase(o2).then(() => null, (e) => e)
            assert.strict.equal(err2.message.split('\n')[0], '截圖與標準圖不一致 ×2/2 [eng-E2E-009]: eng-E2E-009-2-b(比對錯誤), flow-eng-E2E-009-3-c(150px)')
            assert.strict.deepStrictEqual(calls, ['E2E-009-2-b', 'E2E-009-3-c'])
        })

        it('[C29] 收集範圍之三層巢狀(複審 G3): 外層啟用 → 未啟用收集之比對端(遮蔽) → 其 run 內之產製端仍拒絕, 標準圖不動', async function() {
            let outer = createBaselineCollector({ caseKey: 'outer', enabled: true, log: () => {} })
            let written = []
            let mk = (over) => ({
                lang: 'eng',
                name: 'E2E-009',
                launch: async () => fakeBrowser([]),
                pathOf: (lang, k) => picOf(k),
                labelOf: (lang, k) => `flow-${lang}-${k}`,
                match: () => {},
                writeFile: (p) => written.push(p),
                log: () => {},
                env: {},
                ...over,
            })
            let innerRegenErr = null
            await outer.run(async () => {
                await runBaselineCase(mk({
                    mode: 'compare',
                    collect: false,
                    run: async () => {
                        innerRegenErr = await runBaselineCase(mk({ mode: 'regen', collect: false, run: async () => ({ 'E2E-009-1-a': BASE }) })).then(() => null, (e) => e)
                        return { 'E2E-009-2-b': BASE }
                    },
                }))
            })
            assert.match(innerRegenErr.message, /互斥/)
            assert.strict.deepStrictEqual(written, [])
        })

        it('[C30] 測試框架之略過訊號不掩蓋已收集之不符(複審 G4): afterCase 或 onKnownDefect 呼叫 skip 時改拋彙整錯誤; 無不符時 skip 照常', async function() {
            function Pending(message) {
                this.message = message
            }
            //①已知缺陷之延後彙整被 afterCase 之 skip 取代
            let o1 = caseOpt([], {
                collect: true,
                run: async () => {
                    abm(png(300, 200, 150), 'E2E-009-1-a')
                    throw createKnownDefect('缺陷')
                },
                onKnownDefect: async () => {},
                afterCase: async () => {
                    throw new Pending('sync skip; aborting execution')
                },
            })
            let e1 = await runBaselineCase(o1).then(() => null, (e) => e)
            assert.match(e1.message, /^截圖與標準圖不一致 ×1\/1 \[eng-E2E-009\]/)
            //②onKnownDefect 先 skip, afterCase 才比對出不符
            let o2 = caseOpt([], {
                collect: true,
                run: async () => {
                    throw createKnownDefect('缺陷')
                },
                onKnownDefect: async () => {
                    throw new Pending('sync skip; aborting execution')
                },
                afterCase: async () => {
                    abm(png(300, 200, 150), 'E2E-009-2-b')
                },
            })
            let e2 = await runBaselineCase(o2).then(() => null, (e) => e)
            assert.match(e2.message, /^截圖與標準圖不一致 ×1\/1 \[eng-E2E-009\]: flow-eng-E2E-009-2-b\(150px\)/)
            //③無不符: skip 照常(原物件)
            let pend = new Pending('skip')
            let o3 = caseOpt([], {
                collect: true,
                run: async () => {
                    throw createKnownDefect('缺陷')
                },
                onKnownDefect: async () => {
                    throw pend
                }
            })
            assert.strict.equal(await runBaselineCase(o3).then(() => null, (e) => e), pend)
        })

        it('[C31] 同一收集器重用(複審 G2): 前一次 run 遺留之計時器於下一次 run 期間比對照常拋錯、不記入下一次; run 不可重疊', async function() {
            let col = createBaselineCollector({ caseKey: 'reuse', enabled: true, log: () => {} })
            let late = null
            let fired = null
            let firedP = new Promise((resolve) => {
                fired = resolve
            })
            await col.run(async () => {
                setTimeout(() => {
                    try {
                        abm(BASE, 'E2E-404-late')
                        late = 'recorded'
                    }
                    catch (e) {
                        late = 'thrown'
                    }
                    fired()
                }, 20)
            })
            await col.run(async () => {
                await firedP
                abm(BASE, 'E2E-009-1-a')
            })
            assert.strict.equal(late, 'thrown')
            let p = col.run(async () => new Promise((resolve) => setTimeout(resolve, 10)))
            await assert.rejects(col.run(async () => {}), /run 不可重疊/)
            await p
        })

        it('[C32] 明示之收集器須即目前脈絡之作用中收集器(複審 G1): 他案例正在 run 時自其範圍外明示傳入照常拋錯', async function() {
            let b = createBaselineCollector({ caseKey: 'B', enabled: true, log: () => {} })
            let release = null
            let gate = new Promise((resolve) => {
                release = resolve
            })
            let pb = b.run(async () => {
                await gate
            })
            //案例 A 不在 B 之脈絡內
            assert.throws(() => abm(BASE, 'E2E-404-a', { collect: b }), /標準圖不存在/)
            release()
            await pb
            assert.strict.equal(b.records.length, 0)
        })

        it('[C33] 自訂 match 等待期間同案例他處之紀錄不影響補記 pass(複審 G5)', async function() {
            let o = caseOpt([], {
                collect: true,
                run: async () => {
                    setTimeout(() => abm(BASE, 'E2E-404-other'), 5)
                    return { 'E2E-009-2-b': BASE, 'E2E-009-3-c': BASE }
                },
                match: async (b, p, l) => {
                    if (l.endsWith('2-b')) {
                        await new Promise((resolve) => setTimeout(resolve, 30))
                        return
                    }
                    throw new Error('bad')
                },
            })
            let err = await runBaselineCase(o).then(() => null, (e) => e)
            assert.match(err.message, /^截圖與標準圖不一致 ×2\/3 /)
            assert.strict.deepStrictEqual(err.baselineCollect.records.map((r) => [r.label, r.status]), [['flow-eng-E2E-404-other', 'missing'], ['flow-eng-E2E-009-2-b', 'pass'], ['flow-eng-E2E-009-3-c', 'error']])
        })

        it('[C34] 案例清單逐目錄寫入(複審 G7): 一個目錄寫入失敗不影響其餘目錄; 失敗記於 sideErrors／彙整註明; 同毫秒同案例之清單排他建立(-1)', async function() {
            let fpFile = path.join(fdTmp, 'notadir2')
            fs.writeFileSync(fpFile, 'x')
            let dirB = path.join(fdTmp, 'dirB')
            let col = createBaselineCollector({ caseKey: 'm', enabled: true, log: () => {} })
            let semErr = new Error('semantic failure')
            let got = await col.run(async () => {
                col.add({ label: 'a', status: 'diff', numDiff: 1, maxDiffPixels: 0, stem: path.join(fpFile, 'a') })
                col.add({ label: 'b', status: 'diff', numDiff: 1, maxDiffPixels: 0, stem: path.join(dirB, 'b') })
                throw semErr
            }).then(() => null, (e) => e)
            assert.strict.equal(got, semErr)
            assert.match(got.baselineCollect.sideErrors[0], /^案例清單寫入失敗: .+notadir2/)
            let mfB = fs.readdirSync(dirB).filter((f) => f.endsWith('__collect.json'))
            assert.strict.equal(mfB.length, 1)
            assert.strict.equal(JSON.parse(fs.readFileSync(path.join(dirB, mfB[0]), 'utf8')).outcome, 'failed')
            //同毫秒同案例: 第二份為 -1
            let RealDate = Date
            let fixed = new RealDate('2026-09-27T12:34:56.789Z').getTime()
            global.Date = class extends RealDate {
                constructor(...a) {
                    super(...(a.length ? a : [fixed]))
                }

                static now() {
                    return fixed
                }
            }
            try {
                for (let i = 0; i < 2; i++) {
                    let c = createBaselineCollector({ caseKey: 'same', enabled: true, pendingDir: dirB, log: () => {} })
                    await c.run(async () => {
                        c.add({ label: 'x', status: 'error', numDiff: null, message: 'e', stem: null })
                    }).catch(() => {})
                }
            }
            finally {
                global.Date = RealDate
            }
            assert.strict.deepStrictEqual(fs.readdirSync(dirB).filter((f) => f.startsWith('same__')).sort(), ['same__2026-09-27_12-34-56-789-1__collect.json', 'same__2026-09-27_12-34-56-789__collect.json'])
            fs.rmSync(fpFile)
            fs.rmSync(dirB, { recursive: true, force: true })
        })

        it('[C35] 未啟用收集時 runBaselineCase 之 pendingDir 亦傳給預設比對(證據落指定目錄)', async function() {
            let fdP4 = path.join(fdTmp, 'pending4')
            let o = caseOpt([], { env: {}, pendingDir: fdP4, run: async () => ({ 'E2E-009-2-b': png(300, 200, 150) }) })
            delete o.match
            await assert.rejects(runBaselineCase(o), /^Error: 截圖與標準圖不一致 \(diff=150px/)
            assert.strict.equal(fs.readdirSync(fdP4).filter((f) => f.endsWith('.png')).length, 3)
            fs.rmSync(fdP4, { recursive: true, force: true })
        })

    })

})
