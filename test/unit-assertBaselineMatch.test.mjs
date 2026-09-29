import fs from 'fs'
import path from 'path'
import assert from 'assert'
import sharp from 'sharp'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'


//中介資料落 ./test/_tmp/assertBaselineMatch (cwd 相對; gitignore), 測完刪除
let fdTmp = path.resolve('./test/_tmp/assertBaselineMatch')
let fdPending = path.join(fdTmp, 'testPending')


async function solid(w, h, c) {
    return await sharp({ create: { width: w, height: h, channels: 4, background: { ...c, alpha: 1 } } }).png().toBuffer()
}


//在base上改n個像素(每列最多100個, 確保都是「真不同」而非反鋸齒)
async function withDiffPixels(base, n) {
    let { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true })
    let d = Buffer.from(data)
    for (let k = 0; k < n; k++) {
        let x = 10 + (k % 100) * 2
        let y = 10 + Math.floor(k / 100) * 3
        let i = (y * info.width + x) * info.channels
        d[i] = 0
        d[i + 1] = 0
        d[i + 2] = 0
    }
    return await sharp(d, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer()
}


function listPending() {
    return fs.existsSync(fdPending) ? fs.readdirSync(fdPending).sort() : []
}


describe('assertBaselineMatch', function() {

    let base = null
    let fpBase = null

    before(async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        base = await solid(300, 200, { r: 250, g: 250, b: 250 })
        fpBase = path.join(fdTmp, 'pics', 'flow-eng-E2E-001-x.png')
        fs.mkdirSync(path.dirname(fpBase), { recursive: true })
        fs.writeFileSync(fpBase, base)
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.dirname(fdTmp)
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmdirSync(fdParent)
        }
    })

    it('相同即通過, 不產生證據', function() {
        assertBaselineMatch(base, fpBase, 'flow-eng-E2E-001-x', { pendingDir: fdPending })
        assert.strict.deepStrictEqual(listPending(), [])
    })

    it('真不同像素數在容差內(<=100)通過', async function() {
        let cap = await withDiffPixels(base, 100)
        assertBaselineMatch(cap, fpBase, 'flow-eng-E2E-001-x', { pendingDir: fdPending })
        assert.strict.deepStrictEqual(listPending(), [])
    })

    it('超過容差即失敗, 保留capture/baseline/diff三聯組, 訊息含差異數', async function() {
        let cap = await withDiffPixels(base, 150)
        assert.throws(() => assertBaselineMatch(cap, fpBase, 'flow-eng-E2E-001-x', { pendingDir: fdPending }), /diff=150px > maxDiffPixels=100/)
        let fs3 = listPending()
        assert.strict.deepStrictEqual(fs3.length, 3)
        assert.strict.ok(fs3.every((f) => f.startsWith('flow-eng-E2E-001-x__')))
        assert.strict.deepStrictEqual(fs3.map((f) => f.replace(/^.*__/, '')).sort(), ['baseline.png', 'capture.png', 'diff.png'])
        fs.rmSync(fdPending, { recursive: true, force: true })
    })

    it('maxDiffPixels可由呼叫端調整', async function() {
        let cap = await withDiffPixels(base, 150)
        assertBaselineMatch(cap, fpBase, 'x', { pendingDir: fdPending, maxDiffPixels: 200 })
        assert.throws(() => assertBaselineMatch(cap, fpBase, 'x', { pendingDir: fdPending, maxDiffPixels: 10 }), /maxDiffPixels=10/)
        fs.rmSync(fdPending, { recursive: true, force: true })
    })

    it('尺寸不同直接失敗, 只存capture與baseline(無diff)', async function() {
        let cap = await solid(301, 200, { r: 250, g: 250, b: 250 })
        assert.throws(() => assertBaselineMatch(cap, fpBase, 'size', { pendingDir: fdPending }), /尺寸不同 cap=301x200 base=300x200/)
        assert.strict.deepStrictEqual(listPending().map((f) => f.replace(/^.*__/, '')).sort(), ['baseline.png', 'capture.png'])
        fs.rmSync(fdPending, { recursive: true, force: true })
    })

    it('標準圖不存在直接拋錯, 不產生證據', function() {
        assert.throws(() => assertBaselineMatch(base, path.join(fdTmp, 'pics', 'none.png'), 'none', { pendingDir: fdPending }), /標準圖不存在/)
        assert.strict.deepStrictEqual(listPending(), [])
    })

    it('label省略時以標準圖檔名為證據檔名; 特殊字元替換為底線', async function() {
        let cap = await withDiffPixels(base, 300)
        assert.throws(() => assertBaselineMatch(cap, fpBase, '', { pendingDir: fdPending }))
        assert.strict.ok(listPending().every((f) => f.startsWith('flow-eng-E2E-001-x__')))
        fs.rmSync(fdPending, { recursive: true, force: true })
        assert.throws(() => assertBaselineMatch(cap, fpBase, 'a b/c:d', { pendingDir: fdPending }))
        assert.strict.ok(listPending().every((f) => f.startsWith('a_b_c_d__')))
        fs.rmSync(fdPending, { recursive: true, force: true })
    })

    it('同一毫秒連續失敗時以-N區分, 永不覆蓋', async function() {
        let cap = await withDiffPixels(base, 300)
        let RealDate = Date
        let fixed = new RealDate('2026-09-27T12:34:56.789Z')
        //凍結時間使兩次失敗之時間戳相同
        global.Date = class extends RealDate {
            constructor(...a) {
                super(...(a.length ? a : [fixed.getTime()]))
            }

            static now() {
                return fixed.getTime()
            }
        }
        try {
            assert.throws(() => assertBaselineMatch(cap, fpBase, 'same', { pendingDir: fdPending }))
            assert.throws(() => assertBaselineMatch(cap, fpBase, 'same', { pendingDir: fdPending }))
        }
        finally {
            global.Date = RealDate
        }
        let fsN = listPending()
        assert.strict.deepStrictEqual(fsN.length, 6)
        assert.strict.deepStrictEqual(fsN.filter((f) => f.includes('__2026-09-27_12-34-56-789__')).length, 3)
        assert.strict.deepStrictEqual(fsN.filter((f) => f.includes('__2026-09-27_12-34-56-789-1__')).length, 3)
        fs.rmSync(fdPending, { recursive: true, force: true })
    })

    it('不再提供寫檔旁路: 傳 opt.regen 即拋錯且不寫任何檔(標準圖寫檔一律經 runBaselineCase)', async function() {
        let fpNew = path.join(fdTmp, 'pics2', 'sub', 'flow-cht-E2E-002-y.png')
        let cap = await withDiffPixels(base, 500)
        assert.throws(() => assertBaselineMatch(cap, fpNew, 'y', { regen: true, pendingDir: fdPending }), /opt\.regen 已移除/)
        assert.throws(() => assertBaselineMatch(cap, fpBase, 'y', { regen: false, pendingDir: fdPending }), /opt\.regen 已移除/)
        assert.strict.ok(!fs.existsSync(fpNew))
        assert.strict.ok(fs.readFileSync(fpBase).equals(base))
        assert.strict.deepStrictEqual(listPending(), [])
    })

    it('餘裕告警: 通過但真不同像素數超過上限一半時告警, 未超過不告警, 失敗不告警(改拋錯)', async function() {
        let msgs = []
        let warn = (m) => msgs.push(m)
        assertBaselineMatch(await withDiffPixels(base, 60), fpBase, 'near', { pendingDir: fdPending, warn })
        assert.strict.deepStrictEqual(msgs.length, 1)
        assert.strict.ok(msgs[0].includes('[baseline-headroom] near') && msgs[0].includes('diff=60px'))
        assertBaselineMatch(await withDiffPixels(base, 40), fpBase, 'far', { pendingDir: fdPending, warn })
        assert.strict.deepStrictEqual(msgs.length, 1)
        assertBaselineMatch(await withDiffPixels(base, 60), fpBase, 'off', { pendingDir: fdPending, warn, headroomRatio: 1 })
        assert.strict.deepStrictEqual(msgs.length, 1)
        let failCap = await withDiffPixels(base, 150)
        assert.throws(() => assertBaselineMatch(failCap, fpBase, 'fail', { pendingDir: fdPending, warn }), /diff=150px/)
        assert.strict.deepStrictEqual(msgs.length, 1)
        fs.rmSync(fdPending, { recursive: true, force: true })
    })

})
