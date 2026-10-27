import fs from 'fs'
import path from 'path'
import assert from 'assert'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'
import createBaselineCollector from '../src/createBaselineCollector.mjs'
import reviewPendingShots from '../src/reviewPendingShots.mjs'
import acceptPendingShots from '../src/acceptPendingShots.mjs'


//收集模式之審查與採用工具(Gitea issue #19 第1項之 3)之單元測試: 分類(SAME/NOISE/CHANGED/SIZE/MISSING)、取最新、案例清單之帶出、
//採用只處理明列標籤且先全部驗證(另因錯誤失敗、證據過期、無路徑皆拒收)、CLI 未給 --accept 不改寫任何標準圖; 中介資料落 ./test/_tmp/reviewPending, 測完刪除


let fdTmp = path.resolve('./test/_tmp/reviewPending')
let fdPending = path.join(fdTmp, 'testPending')
let fdPics = path.join(fdTmp, 'pics')
let tool = fileURLToPath(new URL('../tools/reviewPending.mjs', import.meta.url))

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
let picOf = (k) => path.join(fdPics, `${k}.png`)

//標準圖目錄之 sha256 快照(證明未改寫)
function snap() {
    let r = {}
    if (!fs.existsSync(fdPics)) {
        return r
    }
    for (let f of fs.readdirSync(fdPics).sort()) {
        let fp = path.join(fdPics, f)
        r[f] = [crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex'), fs.statSync(fp).mtimeMs]
    }
    return r
}

//以收集模式之真實流程產生證據: 案例 A(不符 chg、缺 miss、尺寸 size、同一標籤先後兩組之 twice), 案例 B(另因語意錯誤失敗之 bad), 非收集之 legacy
async function makeEvidence() {
    fs.rmSync(fdTmp, { recursive: true, force: true })
    fs.mkdirSync(fdPics, { recursive: true })
    for (let k of ['chg', 'size', 'bad', 'legacy', 'twice']) {
        fs.writeFileSync(picOf(k), BASE)
    }
    let abm = (buf, k) => assertBaselineMatch(buf, path.relative(process.cwd(), picOf(k)), k, { pendingDir: fdPending })
    let a = createBaselineCollector({ caseKey: 'flow-eng-E2E-001', enabled: true, log: () => {} })
    await assert.rejects(a.run(async () => {
        abm(png(300, 200, 150), 'chg')
        abm(BASE, 'miss')
        abm(png(320, 200), 'size')
        abm(png(300, 200, 150), 'twice')
        await new Promise((resolve) => setTimeout(resolve, 5))
        abm(png(300, 200, 300), 'twice')
    }), /×5\/5/)
    let b = createBaselineCollector({ caseKey: 'flow-eng-E2E-002', enabled: true, log: () => {} })
    await assert.rejects(b.run(async () => {
        abm(png(300, 200, 150), 'bad')
        throw new Error('語意: 應顯示 3 列')
    }), /語意/)
    assert.throws(() => abm(png(300, 200, 150), 'legacy'), /截圖與標準圖不一致/)
}


describe('reviewPendingShots／acceptPendingShots／tools/reviewPending.mjs', function() {

    beforeEach(async function() {
        await makeEvidence()
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
    })

    it('[R01] 分類與帶出: 各標籤取最新一組; CHANGED 附差異外框; 缺標準圖為 MISSING; 案例清單帶出 caseKey／outcome／標準圖路徑; 另因錯誤失敗與非收集之證據不可採用', async function() {
        let before = snap()
        let rs = await reviewPendingShots({ pendingDir: fdPending })
        let brief = rs.map((r) => [r.label, r.cls, r.numDiff, r.caseKey, r.outcome, r.acceptable])
        assert.strict.deepStrictEqual(brief, [
            ['bad', 'CHANGED', 150, 'flow-eng-E2E-002', 'failed', false],
            ['chg', 'CHANGED', 150, 'flow-eng-E2E-001', 'mismatch', true],
            ['legacy', 'CHANGED', 150, null, null, false],
            ['miss', 'MISSING', null, 'flow-eng-E2E-001', 'mismatch', true],
            ['size', 'SIZE', null, 'flow-eng-E2E-001', 'mismatch', true],
            ['twice', 'CHANGED', 300, 'flow-eng-E2E-001', 'mismatch', true],
        ])
        let chg = rs.find((r) => r.label === 'chg')
        assert.strict.deepStrictEqual(chg.box, { x: 10, y: 10, w: 199, h: 4 })
        assert.strict.equal(path.resolve(chg.baselinePath), picOf('chg'))
        assert.strict.deepStrictEqual(snap(), before)
        //labels 篩選、容差放寬即改判 NOISE、RGBA 相同為 SAME
        let rs2 = await reviewPendingShots({ pendingDir: fdPending, labels: ['chg'], maxDiffPixels: 200 })
        assert.strict.deepStrictEqual(rs2.map((r) => [r.label, r.cls]), [['chg', 'NOISE']])
        let stem = rs2[0].stem
        fs.copyFileSync(`${stem}__baseline.png`, `${stem}__capture.png`)
        assert.strict.equal((await reviewPendingShots({ pendingDir: fdPending, labels: ['chg'] }))[0].cls, 'SAME')
        assert.strict.deepStrictEqual(await reviewPendingShots({ pendingDir: path.join(fdTmp, 'none') }), [])
    })

    it('[R02] cropDir: CHANGED 者寫並排裁圖(左標準圖、右當次截圖, 差異外框外擴 margin)', async function() {
        let fdCrop = path.join(fdTmp, 'crops')
        let rs = await reviewPendingShots({ pendingDir: fdPending, labels: ['chg', 'miss'], cropDir: fdCrop, margin: 5 })
        let chg = rs.find((r) => r.label === 'chg')
        let side = PNG.sync.read(fs.readFileSync(chg.sidePath))
        //外框 199x4 外擴 5 → 209x14, 並排加間隔 8
        assert.strict.deepStrictEqual([side.width, side.height], [209 * 2 + 8, 14])
        assert.strict.equal(rs.find((r) => r.label === 'miss').sidePath, null)
        assert.strict.deepStrictEqual(fs.readdirSync(fdCrop), ['chg__side.png'])
    })

    it('[R03] acceptPendingShots: 未指定標籤即拋錯; 任一標籤不合格(無證據／另因錯誤失敗／非收集無路徑)即全部不採用', async function() {
        let before = snap()
        for (let labels of [undefined, [], [''], 'chg']) {
            await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels }), /labels 須為非空/)
        }
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['chg', 'nope'] }), /nope: .+內無此標籤之證據/)
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['chg', 'bad'] }), /bad: 所屬案例 flow-eng-E2E-002 另因錯誤失敗/)
        //無案例清單之證據: 未明示 legacy 即拒收(即使給了 pathOf; 複審 G7); 明示 legacy 而無 pathOf 亦拒收
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['legacy'], pathOf: (l) => picOf(l) }), /legacy: 無案例清單\(無法證實其案例結局\)/)
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['legacy'], legacy: true }), /legacy: 無案例清單可取標準圖路徑/)
        assert.strict.deepStrictEqual(snap(), before)
    })

    it('[R04] acceptPendingShots: 證據過期(正式標準圖已改寫, 或缺標準圖之證據而正式圖已出現)即拒收; dryRun 只回預定清單不寫', async function() {
        fs.writeFileSync(picOf('chg'), png(300, 200, 7))
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['chg'] }), /chg: 正式標準圖 .+已與證據中之標準圖副本不同\(證據過期\)/)
        fs.writeFileSync(picOf('miss'), BASE)
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['miss'] }), /miss: 證據為缺標準圖，但 .+現已存在\(證據過期\)/)
        fs.rmSync(picOf('miss'))
        let before = snap()
        let plan = await acceptPendingShots({ pendingDir: fdPending, labels: ['size', 'miss'], dryRun: true })
        assert.strict.deepStrictEqual(plan.map((p) => [p.label, p.cls, p.to]), [['size', 'SIZE', picOf('size')], ['miss', 'MISSING', picOf('miss')]])
        assert.strict.deepStrictEqual(snap(), before)
    })

    it('[R05] acceptPendingShots: 只把明列標籤之最新 capture 複製為正式標準圖(含缺標準圖者新建); 未列者不動; 非收集證據可以 pathOf 指定路徑', async function() {
        let logs = []
        let before = snap()
        let done = await acceptPendingShots({ pendingDir: fdPending, labels: ['twice', 'miss'], log: (s) => logs.push(s) })
        assert.strict.deepStrictEqual(done.map((p) => p.label), ['twice', 'miss'])
        assert.ok(fs.readFileSync(picOf('twice')).equals(png(300, 200, 300)))
        assert.ok(fs.readFileSync(picOf('miss')).equals(BASE))
        let after = snap()
        for (let k of ['bad.png', 'chg.png', 'legacy.png', 'size.png']) {
            assert.strict.deepStrictEqual(after[k], before[k])
        }
        assert.strict.equal(logs.length, 2)
        assert.match(logs[0], /^\[accept\] twice \(CHANGED\) → .+twice\.png$/)
        await acceptPendingShots({ pendingDir: fdPending, labels: ['legacy'], legacy: true, pathOf: (l) => picOf(l), log: null })
        assert.ok(fs.readFileSync(picOf('legacy')).equals(png(300, 200, 150)))
    })

    it('[R06] CLI: 未給 --accept 只審查(印分類、寫 --json)不改寫任何標準圖; --accept 不合格者離開碼 1 且一張都不寫; 合格者只寫明列者; 不明參數離開碼 2', function() {
        let before = snap()
        let fpJson = path.join(fdTmp, 'review.json')
        let r = spawnSync(process.execPath, [tool, '--pending', fdPending, '--json', fpJson], { encoding: 'utf8' })
        assert.strict.equal(r.status, 0, r.stderr)
        assert.match(r.stdout, /\[review-pending\] .+: 6 個標籤 CHANGED=4 MISSING=1 SIZE=1/)
        assert.match(r.stdout, /CHANGED {2}bad diff=150px box=10,10,199x4 case=flow-eng-E2E-002\(failed\) 不可採用/)
        assert.strict.equal(JSON.parse(fs.readFileSync(fpJson, 'utf8')).length, 6)
        assert.strict.deepStrictEqual(snap(), before)
        let r1 = spawnSync(process.execPath, [tool, '--pending', fdPending, '--accept', 'chg,bad'], { encoding: 'utf8' })
        assert.strict.equal(r1.status, 1)
        assert.match(r1.stderr, /未採用任何截圖/)
        assert.strict.deepStrictEqual(snap(), before)
        let rd = spawnSync(process.execPath, [tool, '--pending', fdPending, '--accept', 'chg', '--dry-run'], { encoding: 'utf8' })
        assert.strict.equal(rd.status, 0, rd.stderr)
        assert.match(rd.stdout, /\[accept-dry-run\] chg \(CHANGED\) → /)
        assert.strict.deepStrictEqual(snap(), before)
        let r2 = spawnSync(process.execPath, [tool, '--pending', fdPending, '--accept', 'chg'], { encoding: 'utf8' })
        assert.strict.equal(r2.status, 0, r2.stderr)
        let after = snap()
        assert.notDeepStrictEqual(after['chg.png'], before['chg.png'])
        delete after['chg.png']
        delete before['chg.png']
        assert.strict.deepStrictEqual(after, before)
        let r3 = spawnSync(process.execPath, [tool, '--bogus'], { encoding: 'utf8' })
        assert.strict.equal(r3.status, 2)
        let r4 = spawnSync(process.execPath, [tool, '--accept'], { encoding: 'utf8' })
        assert.strict.equal(r4.status, 2)
        let r5 = spawnSync(process.execPath, [tool, '--pending', fdPending, '--since', 'not-a-time'], { encoding: 'utf8' })
        assert.strict.equal(r5.status, 2)
        assert.match(r5.stderr, /since 無法解析為時間/)
    })

    it('[R08] 多個標籤指向同一標準圖即全部不採用(外審 F15)', async function() {
        let col = createBaselineCollector({ caseKey: 'flow-eng-E2E-003', enabled: true, log: () => {} })
        await assert.rejects(col.run(async () => {
            assertBaselineMatch(png(300, 200, 150), picOf('legacy'), 'dupA', { pendingDir: fdPending })
            assertBaselineMatch(png(300, 200, 170), picOf('legacy'), 'dupB', { pendingDir: fdPending })
        }), /×2\/2/)
        let before = snap()
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['dupA', 'dupB'] }), /dupB: 與 dupA 指向同一標準圖/)
        assert.strict.deepStrictEqual(snap(), before)
    })

    it('[R09] 證據之 capture 不是可解碼之 PNG 即拒收(外審 F17)', async function() {
        let r = (await reviewPendingShots({ pendingDir: fdPending, labels: ['miss'] }))[0]
        fs.writeFileSync(r.capturePath, 'not a png')
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['miss'] }), /miss: 證據之 capture 不是可解碼之 PNG/)
        assert.strict.equal(fs.existsSync(picOf('miss')), false)
    })

    it('[R10] 相對標準圖路徑以比對時之工作目錄解析(自他目錄執行 CLI 仍寫回原處); --root 明給者以之(外審 F18)', function() {
        let fdOther = path.join(fdTmp, 'other')
        fs.mkdirSync(fdOther, { recursive: true })
        let r = spawnSync(process.execPath, [tool, '--pending', fdPending, '--accept', 'miss'], { encoding: 'utf8', cwd: fdOther })
        assert.strict.equal(r.status, 0, r.stderr)
        assert.strict.equal(fs.existsSync(picOf('miss')), true)
        assert.strict.equal(fs.existsSync(path.join(fdOther, path.relative(process.cwd(), picOf('miss')))), false)
        fs.rmSync(picOf('miss'))
        let r2 = spawnSync(process.execPath, [tool, '--pending', fdPending, '--accept', 'miss', '--root', fdOther], { encoding: 'utf8' })
        assert.strict.equal(r2.status, 0, r2.stderr)
        assert.strict.equal(fs.existsSync(path.join(fdOther, path.relative(process.cwd(), picOf('miss')))), true)
        assert.strict.equal(fs.existsSync(picOf('miss')), false)
    })

    it('[R10b] pathOf 回傳相對路徑時亦以 root 解析(legacy 證據)', async function() {
        let fdRoot = path.join(fdTmp, 'root2')
        //目標須仍與證據中之標準圖副本相同(過期檢查)
        fs.mkdirSync(path.join(fdRoot, 'pics'), { recursive: true })
        fs.writeFileSync(path.join(fdRoot, 'pics', 'legacy.png'), BASE)
        await acceptPendingShots({ pendingDir: fdPending, labels: ['legacy'], legacy: true, root: fdRoot, pathOf: (l) => `pics/${l}.png`, log: null })
        assert.ok(fs.readFileSync(path.join(fdRoot, 'pics', 'legacy.png')).equals(png(300, 200, 150)))
    })

    it('[R13] 跨目錄同名證據(同標籤同毫秒)以完整證據路徑對應清單紀錄, 取各自之 cwd(複審 G8)', async function() {
        let ts = '2026-09-27_12-34-56-789'
        let mk = (dir) => {
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, `x__${ts}__capture.png`), BASE)
            return path.join(dir, `x__${ts}`)
        }
        let p1 = path.join(fdTmp, 'cwdA', 'pend')
        let p2 = path.join(fdTmp, 'cwdB', 'pend')
        let s1 = mk(p1)
        let s2 = mk(p2)
        let cwdA = path.join(fdTmp, 'cwdA')
        let cwdB = path.join(fdTmp, 'cwdB')
        let recs = [
            { label: 'x', status: 'missing', baselinePath: 'pics/x.png', cwd: cwdA, stem: path.relative(cwdA, s1) },
            { label: 'x', status: 'missing', baselinePath: 'pics/x.png', cwd: cwdB, stem: path.relative(cwdB, s2) },
        ]
        for (let d of [p1, p2]) {
            fs.writeFileSync(path.join(d, `case__${ts}__collect.json`), JSON.stringify({ caseKey: 'case', outcome: 'mismatch', error: null, cwd: cwdA, records: recs }))
        }
        let r = (await reviewPendingShots({ pendingDir: p2 }))[0]
        assert.strict.deepStrictEqual([r.cwd, r.conflict, r.acceptable], [cwdB, false, true])
        await acceptPendingShots({ pendingDir: p2, labels: ['x'], log: null })
        assert.strict.deepStrictEqual([fs.existsSync(path.join(cwdB, 'pics', 'x.png')), fs.existsSync(path.join(cwdA, 'pics', 'x.png'))], [true, false])
    })

    it('[R14] 同一目的地之別名(junction、大小寫)亦視為同一, 全部不採用(複審 G9)', async function() {
        let real = path.join(fdTmp, 'realPics')
        let alias = path.join(fdTmp, 'aliasPics')
        fs.mkdirSync(real, { recursive: true })
        fs.symlinkSync(real, alias, 'junction')
        try {
            let col = createBaselineCollector({ caseKey: 'flow-eng-E2E-004', enabled: true, log: () => {} })
            await assert.rejects(col.run(async () => {
                assertBaselineMatch(BASE, path.join(real, 'j.png'), 'jA', { pendingDir: fdPending })
                assertBaselineMatch(png(300, 200, 150), path.join(alias, 'j.png'), 'jB', { pendingDir: fdPending })
                assertBaselineMatch(png(300, 200, 170), path.join(real, 'J.PNG'), 'jC', { pendingDir: fdPending })
            }), /×3\/3/)
            await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['jA', 'jB'] }), /jB: 與 jA 指向同一標準圖/)
            if (process.platform === 'win32') {
                await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['jA', 'jC'] }), /jC: 與 jA 指向同一標準圖/)
            }
            assert.strict.equal(fs.existsSync(path.join(real, 'j.png')), false)
            //既有標準圖經 junction 之別名: 以檔案身分判定為同一
            fs.writeFileSync(path.join(real, 'k.png'), BASE)
            let col2 = createBaselineCollector({ caseKey: 'flow-eng-E2E-005', enabled: true, log: () => {} })
            await assert.rejects(col2.run(async () => {
                assertBaselineMatch(png(300, 200, 150), path.join(real, 'k.png'), 'kA', { pendingDir: fdPending })
                assertBaselineMatch(png(300, 200, 170), path.join(alias, 'k.png'), 'kB', { pendingDir: fdPending })
            }), /×2\/2/)
            await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['kA', 'kB'] }), /kB: 與 kA 指向同一標準圖/)
            assert.ok(fs.readFileSync(path.join(real, 'k.png')).equals(BASE))
        }
        finally {
            fs.rmdirSync(alias)
        }
    })

    it('[R11] 並排裁圖排他建立, 永不覆蓋既有檔(cropDir 誤指標準圖目錄亦不改寫; 外審 F21)', async function() {
        let fpAlias = path.join(fdPics, 'chg__side.png')
        fs.writeFileSync(fpAlias, BASE)
        let before = snap()
        let rs = await reviewPendingShots({ pendingDir: fdPending, labels: ['chg'], cropDir: fdPics })
        assert.strict.equal(path.basename(rs[0].sidePath), 'chg__side-1.png')
        let after = snap()
        assert.strict.deepStrictEqual(after['chg__side.png'], before['chg__side.png'])
        assert.ok(fs.readFileSync(fpAlias).equals(BASE))
        //-1 亦已存在時取 -2, 仍不覆蓋
        let side1 = fs.readFileSync(path.join(fdPics, 'chg__side-1.png'))
        let rs2 = await reviewPendingShots({ pendingDir: fdPending, labels: ['chg'], cropDir: fdPics })
        assert.strict.equal(path.basename(rs2[0].sidePath), 'chg__side-2.png')
        assert.ok(fs.readFileSync(path.join(fdPics, 'chg__side-1.png')).equals(side1))
    })

    it('[R12] 同一證據被不同案例或結局之清單引用(跨行程撞名)即標衝突、不可採用(外審 F16)', async function() {
        let r = (await reviewPendingShots({ pendingDir: fdPending, labels: ['chg'] }))[0]
        let mf = fs.readdirSync(fdPending).find((f) => f.startsWith('flow-eng-E2E-001__') && f.endsWith('__collect.json'))
        let data = JSON.parse(fs.readFileSync(path.join(fdPending, mf), 'utf8'))
        data.caseKey = 'flow-eng-E2E-777'
        data.outcome = 'failed'
        data.records = data.records.filter((x) => x.stem && path.basename(x.stem) === path.basename(r.stem))
        fs.writeFileSync(path.join(fdPending, 'flow-eng-E2E-777__2026-10-28_00-00-00-000__collect.json'), JSON.stringify(data))
        let r2 = (await reviewPendingShots({ pendingDir: fdPending, labels: ['chg'] }))[0]
        assert.strict.deepStrictEqual([r2.conflict, r2.acceptable], [true, false])
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['chg'] }), /chg: 證據同時被不同案例或結局之案例清單引用/)
    })

    it('[R07] since: 只看(與只採用)該時刻之後之證據, 前幾趟殘留之舊證據不列入、不可採用', async function() {
        let all = await reviewPendingShots({ pendingDir: fdPending })
        let toMs = (ts) => Date.parse(ts.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})$/, '$1T$2:$3:$4.$5Z'))
        let tChg = toMs(all.find((r) => r.label === 'chg').ts)
        let tLegacy = toMs(all.find((r) => r.label === 'legacy').ts)
        assert.ok(tLegacy > tChg)
        let rs = await reviewPendingShots({ pendingDir: fdPending, since: tLegacy })
        assert.ok(rs.some((r) => r.label === 'legacy'))
        assert.ok(!rs.some((r) => r.label === 'chg'))
        assert.strict.deepStrictEqual(await reviewPendingShots({ pendingDir: fdPending, since: new Date(tLegacy + 60000) }), [])
        assert.strict.equal((await reviewPendingShots({ pendingDir: fdPending, since: '2000-01-01T00:00:00Z' })).length, 6)
        await assert.rejects(reviewPendingShots({ pendingDir: fdPending, since: 'x' }), /since 無法解析/)
        let before = snap()
        await assert.rejects(acceptPendingShots({ pendingDir: fdPending, labels: ['chg'], since: tLegacy }), /chg: .+內無此標籤之證據\(since 之後\)/)
        assert.strict.deepStrictEqual(snap(), before)
    })

})
