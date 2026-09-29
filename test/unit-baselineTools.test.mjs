import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'
import snapshotBaselines from '../src/snapshotBaselines.mjs'
import diffBaselineSnapshots from '../src/diffBaselineSnapshots.mjs'
import compareImageDirs from '../src/compareImageDirs.mjs'


//標準圖快照與目錄比對之單元測試(中介檔落 test/_tmp/baselineTools, 測完即刪)


let root = path.resolve('./test/_tmp/baselineTools')
let png = (w, h, fill, patch = []) => {
    let p = new PNG({ width: w, height: h })
    for (let i = 0; i < p.data.length; i += 4) {
        p.data[i] = fill
        p.data[i + 1] = fill
        p.data[i + 2] = fill
        p.data[i + 3] = 255
    }
    for (let [x, y, v] of patch) {
        let i = (y * w + x) * 4
        p.data[i] = v
        p.data[i + 1] = v
        p.data[i + 2] = v
    }
    return PNG.sync.write(p)
}
let write = (rel, buf) => {
    let p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, buf)
    return p
}


describe('snapshotBaselines / diffBaselineSnapshots / compareImageDirs', function() {

    beforeEach(function() {
        fs.rmSync(root, { recursive: true, force: true })
    })
    after(function() {
        fs.rmSync(root, { recursive: true, force: true })
    })

    it('快照含子目錄之 png(以 / 分隔之相對路徑), 目錄不存在回空物件', function() {
        write('pics/a/x.png', png(4, 4, 10))
        write('pics/b/y.png', png(4, 4, 20))
        write('pics/b/z.txt', Buffer.from('no'))
        let s = snapshotBaselines(path.join(root, 'pics'))
        assert.strict.deepStrictEqual(Object.keys(s).sort(), ['a/x.png', 'b/y.png'])
        assert.strict.equal(s['a/x.png'].sha256.length, 64)
        assert.strict.deepStrictEqual(snapshotBaselines(path.join(root, 'none')), {})
    })

    it('比對快照: 新增、刪除、內容改變、內容相同但被重寫(mtime)皆列出; 全無才 unchanged', function() {
        let pa = write('pics/a.png', png(4, 4, 10))
        write('pics/b.png', png(4, 4, 20))
        let pc = write('pics/c.png', png(4, 4, 30))
        let before = snapshotBaselines(path.join(root, 'pics'))
        assert.strict.equal(diffBaselineSnapshots(before, snapshotBaselines(path.join(root, 'pics'))).unchanged, true)
        fs.writeFileSync(pa, png(4, 4, 11)) //內容改變
        let t = new Date(Date.now() + 5000)
        fs.utimesSync(pc, t, t) //內容相同但 mtime 改變
        fs.rmSync(path.join(root, 'pics/b.png'))
        write('pics/d.png', png(4, 4, 40))
        let r = diffBaselineSnapshots(before, snapshotBaselines(path.join(root, 'pics')))
        assert.strict.deepStrictEqual(r, { added: ['d.png'], removed: ['b.png'], changed: ['a.png'], touched: ['c.png'], unchanged: false })
    })

    it('目錄比對: 位元組相同 / RGBA 相同但編碼不同 / 容差內 / 超容差 / 尺寸不同 / 缺檔 / 只在對照目錄', function() {
        let same = png(10, 10, 50)
        write('A/same.png', same)
        write('B/same.png', same)
        //RGBA 相同但位元組不同(不同掃描列濾波)
        let p = PNG.sync.read(same)
        let ra = PNG.sync.write(p, { filterType: 0 })
        let rb = PNG.sync.write(p, { filterType: 4 })
        assert.strict.ok(!ra.equals(rb))
        write('A/reenc.png', ra)
        write('B/reenc.png', rb)
        write('A/small.png', png(10, 10, 50, [[1, 1, 255]]))
        write('B/small.png', png(10, 10, 50))
        write('A/big.png', png(10, 10, 0))
        write('B/big.png', png(10, 10, 255))
        write('A/size.png', png(10, 11, 50))
        write('B/size.png', png(10, 10, 50))
        write('A/new.png', png(10, 10, 50))
        write('B/old.png', png(10, 10, 50))
        let r = compareImageDirs(path.join(root, 'A'), path.join(root, 'B'), { maxDiffPixels: 5 })
        let by = Object.fromEntries(r.files.map((f) => [f.file, f]))
        assert.strict.deepStrictEqual([by['same.png'].bytesEqual, by['same.png'].rgbaEqual], [true, true])
        assert.strict.deepStrictEqual([by['reenc.png'].bytesEqual, by['reenc.png'].rgbaEqual, by['reenc.png'].numDiff], [false, true, 0])
        assert.strict.deepStrictEqual([by['small.png'].rgbaEqual, by['small.png'].numDiff, by['small.png'].withinTolerance], [false, 1, true])
        assert.strict.deepStrictEqual([by['big.png'].numDiff, by['big.png'].withinTolerance], [100, false])
        assert.strict.equal(by['size.png'].status, 'sizeMismatch')
        assert.strict.equal(by['new.png'].status, 'missingInB')
        assert.strict.deepStrictEqual(r.onlyInB, ['old.png'])
        assert.strict.deepStrictEqual(r.summary, { total: 6, bytesEqual: 1, rgbaEqual: 2, equivalent: 2, withinTolerance: 3, exceeded: 1, missingInB: 1, sizeMismatch: 1, onlyInB: 1 })
        //RGBA 相異數與外接框
        assert.strict.deepStrictEqual([by['small.png'].rgbaDiff, by['small.png'].rgbaDiffBox, by['small.png'].equivalent], [1, { x0: 1, y0: 1, x1: 1, y1: 1 }, false])
    })

    it('等價層: RGBA 相異像素全落在登錄漂移點(座標 + 各通道差上限 + 適用檔名)才算等價; pixelmatch 計數 0 不等於等價', function() {
        let dA = path.join(root, 'DA')
        let dB = path.join(root, 'DB')
        write('DA/eng-x.png', png(10, 10, 50, [[1, 1, 58]])) //單點差 8 級
        write('DB/eng-x.png', png(10, 10, 50))
        write('DA/eng-flat.png', png(10, 10, 70)) //整片均勻差 20 級: pixelmatch 計數 0, 但不是登錄漂移
        write('DB/eng-flat.png', png(10, 10, 50))
        let r0 = compareImageDirs(dA, dB)
        let by0 = Object.fromEntries(r0.files.map((f) => [f.file, f]))
        assert.strict.deepStrictEqual([by0['eng-flat.png'].numDiff, by0['eng-flat.png'].equivalent, by0['eng-flat.png'].rgbaDiff], [0, false, 100])
        assert.strict.equal(by0['eng-x.png'].equivalent, false)
        let drift = [{ x: 1, y: 1, maxDelta: 9, files: /^eng-/ }]
        let r1 = compareImageDirs(dA, dB, { drift })
        let by1 = Object.fromEntries(r1.files.map((f) => [f.file, f]))
        assert.strict.deepStrictEqual([by1['eng-x.png'].equivalent, by1['eng-flat.png'].equivalent], [true, false])
        assert.strict.equal(r1.summary.equivalent, 1)
        //差超過上限或檔名不適用即不算
        let r2 = compareImageDirs(dA, dB, { drift: [{ x: 1, y: 1, maxDelta: 7 }] })
        assert.strict.equal(r2.files.find((f) => f.file === 'eng-x.png').equivalent, false)
        let r3 = compareImageDirs(dA, dB, { drift: [{ x: 1, y: 1, maxDelta: 9, files: /^cht-/ }] })
        assert.strict.equal(r3.files.find((f) => f.file === 'eng-x.png').equivalent, false)
    })

})
