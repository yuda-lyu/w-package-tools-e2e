import fs from 'fs'
import path from 'path'
import assert from 'assert'
import sharp from 'sharp'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'


//比對之色差度量固定為 pixelmatch 7.x 之判定(規則帳本 sgud/rule/rulebook_baselineRun.md §8.2 第 27 條):
//判定函數在 7.x 為 YIQ 平方距離(> 35215*threshold^2), 8.x 起為 OKLab HyAB 距離(> threshold), 兩者對同一對顏色之判定不同,
//threshold 與 checkerboard 皆無法換算, 故升至 8 以上會使既有標準圖之比對結果改變.本檔以本套件自己之比對入口(assertBaselineMatch)
//固定 7.x 之判定: 於 8.x 下 M01～M03、M05 會失敗, 作為升版時之守門(不是放寬或重產標準圖之理由).
//中介資料落 ./test/_tmp/compareMetric (cwd 相對; gitignore), 測完刪除
let fdTmp = path.resolve('./test/_tmp/compareMetric')
let fdPending = path.join(fdTmp, 'testPending')


async function solid(w, h, rgba) {
    let [r, g, b, a] = rgba
    return await sharp(Buffer.alloc(w * h * 4).map((_, i) => [r, g, b, a][i % 4]), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}


//baseline 與 capture 皆為純色圖: 回傳 assertBaselineMatch 之結果, 通過回 null, 不一致回錯誤訊息
async function cmp(w, h, c1, c2, maxDiffPixels = 100) {
    let fpBase = path.join(fdTmp, 'pics', 'x.png')
    fs.mkdirSync(path.dirname(fpBase), { recursive: true })
    fs.writeFileSync(fpBase, await solid(w, h, c1))
    let cap = await solid(w, h, c2)
    try {
        assertBaselineMatch(cap, fpBase, 'x', { pendingDir: fdPending, maxDiffPixels })
        return null
    }
    catch (err) {
        return err.message
    }
}


describe('比對之色差度量(固定為 pixelmatch 7.x 之判定)', function() {

    before(function() {
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

    it('[M01] 黑(0,0,0)與 24 級灰: 低於約 26 級之均勻差不計, 通過(8.x 之 OKLab 於近黑區較敏感, 會判為整片差異)', async function() {
        assert.strict.equal(await cmp(100, 100, [0, 0, 0, 255], [24, 24, 24, 255]), null)
    })

    it('[M02] 白(255)與 227(差 28 級): 超過約 26 級, 整片計為差異 10000 像素而失敗(8.x 判為相同而通過)', async function() {
        let msg = await cmp(100, 100, [255, 255, 255, 255], [227, 227, 227, 255])
        assert.ok(msg && /diff=10000px/.test(msg), `應判為整片差異: ${msg}`)
    })

    it('[M03] 純紅 #ff0000 與 #ff2020: 計為差異 10000 像素而失敗(8.x 判為相同而通過)', async function() {
        let msg = await cmp(100, 100, [255, 0, 0, 255], [255, 32, 32, 255])
        assert.ok(msg && /diff=10000px/.test(msg), `應判為整片差異: ${msg}`)
    })

    it('[M04] 對照組(7.x 與 8.x 判定相同): 白與 #eeeeee(差 17 級)通過; 白與 #e0e0e0(差 31 級)失敗', async function() {
        assert.strict.equal(await cmp(100, 100, [255, 255, 255, 255], [238, 238, 238, 255]), null)
        let msg = await cmp(100, 100, [255, 255, 255, 255], [224, 224, 224, 255])
        assert.ok(msg && /diff=10000px/.test(msg), `應判為整片差異: ${msg}`)
    })

    it('[M05] 半透明像素(含 pixelmatch 預設之 checkerboard 背景): (200,50,50,255) 對 (200,50,50,200) 之 40x40 純色圖計 798 像素(8.x 為 201; 8.x 之 checkerboard:false 為 1600, 亦非 7.x 預設)', async function() {
        let msg = await cmp(40, 40, [200, 50, 50, 255], [200, 50, 50, 200], 100)
        assert.ok(msg && /diff=798px/.test(msg), `半透明計數應為 798: ${msg}`)
    })

})
