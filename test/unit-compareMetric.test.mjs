import fs from 'fs'
import path from 'path'
import assert from 'assert'
import sharp from 'sharp'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'
import compareImageDirs from '../src/compareImageDirs.mjs'
import writeBaselineIfChanged from '../src/writeBaselineIfChanged.mjs'
import pixelmatchOpt from '../src/pixelmatchOpt.mjs'


//比對之色差度量與選項之契約(規則帳本 sgud/rule/rulebook_baselineRun.md §8.2 規則 27、28):
//色差度量為 pixelmatch 8(OKLab 之 toe 校正明度＋HyAB 距離, 距離大於 threshold 即判為差異), 非 7.x 之 YIQ 平方距離(> 35215·threshold²);
//兩者對同一對顏色之判定不同, 且 8 之 checkerboard 圖樣與 7.x 不同.選項集中於 src/pixelmatchOpt.mjs(threshold 0.1、includeAA false、checkerboard true),
//所有 pixelmatch 呼叫皆展開之.本檔以本套件自己之比對入口固定 8 之判定與所選選項: 回到 7.x 之判定(M01～M03、M05、M10)、
//改動 threshold 預設(M06、M07)、拿掉 checkerboard(M05)、或有呼叫處不經 pixelmatchOpt(M09)皆會失敗.
//中介資料落 ./test/_tmp/compareMetric (cwd 相對; gitignore), 測完刪除
let fdTmp = path.resolve('./test/_tmp/compareMetric')
let fdPending = path.join(fdTmp, 'testPending')
let fdSrc = path.resolve('./src')


async function solid(w, h, rgba) {
    let [r, g, b, a] = rgba
    return await sharp(Buffer.alloc(w * h * 4).map((_, i) => [r, g, b, a][i % 4]), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}


//baseline 與 capture 皆為純色圖: 回傳 assertBaselineMatch 之結果, 通過回 null, 不一致回錯誤訊息
async function cmp(w, h, c1, c2, opt = {}) {
    let fpBase = path.join(fdTmp, 'pics', 'x.png')
    fs.mkdirSync(path.dirname(fpBase), { recursive: true })
    fs.writeFileSync(fpBase, await solid(w, h, c1))
    let cap = await solid(w, h, c2)
    try {
        assertBaselineMatch(cap, fpBase, 'x', { pendingDir: fdPending, ...opt })
        return null
    }
    catch (err) {
        return err.message
    }
}


describe('比對之色差度量與選項(pixelmatch 8 之 OKLab HyAB; 選項集中於 pixelmatchOpt)', function() {

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

    it('[M01] 黑(0,0,0)對 24 級灰: OKLab 於近黑區較敏感, 整片(10000 像素)判為差異而失敗(7.x 之 YIQ 判為相同而通過)', async function() {
        let msg = await cmp(100, 100, [0, 0, 0, 255], [24, 24, 24, 255])
        assert.ok(msg && /diff=10000px/.test(msg), `應判為整片差異: ${msg}`)
    })

    it('[M02] 白(255)對 227(差 28 級): 近白區較寬, 判為相同而通過(7.x 判為整片差異)', async function() {
        assert.strict.equal(await cmp(100, 100, [255, 255, 255, 255], [227, 227, 227, 255]), null)
    })

    it('[M03] 純紅 #ff0000 對 #ff2020: 判為相同而通過(7.x 判為整片差異)', async function() {
        assert.strict.equal(await cmp(100, 100, [255, 0, 0, 255], [255, 32, 32, 255]), null)
    })

    it('[M04] 對照組(8 與 7.x 判定相同): 白對 #eeeeee(差 17 級)通過; 白對 #e0e0e0(差 31 級)整片失敗', async function() {
        assert.strict.equal(await cmp(100, 100, [255, 255, 255, 255], [238, 238, 238, 255]), null)
        let msg = await cmp(100, 100, [255, 255, 255, 255], [224, 224, 224, 255])
        assert.ok(msg && /diff=10000px/.test(msg), `應判為整片差異: ${msg}`)
    })

    it('[M05] 半透明像素以棋盤格背景比對(checkerboard:true): (200,50,50,255) 對 (200,50,50,200) 之 40x40 純色圖計 201 像素(7.x 為 798; 8 之 checkerboard:false 疊白底為 1600)', async function() {
        let msg = await cmp(40, 40, [200, 50, 50, 255], [200, 50, 50, 200])
        assert.ok(msg && /diff=201px/.test(msg), `半透明計數應為 201: ${msg}`)
    })

    it('[M06] threshold 預設 0.1 之臨界: 灰 128 對 154(差 26 級)通過, 對 155(差 27 級)整片失敗(預設改為 0.09 或 0.11 即翻轉)', async function() {
        assert.strict.equal(await cmp(100, 100, [128, 128, 128, 255], [154, 154, 154, 255]), null)
        let msg = await cmp(100, 100, [128, 128, 128, 255], [155, 155, 155, 255])
        assert.ok(msg && /diff=10000px/.test(msg), `差 27 級應判為整片差異: ${msg}`)
    })

    it('[M07] opt.threshold 仍可覆寫(介面不變): 灰 128 對 155 在 threshold 0.2 通過、0.1 失敗', async function() {
        assert.strict.equal(await cmp(100, 100, [128, 128, 128, 255], [155, 155, 155, 255], { threshold: 0.2 }), null)
        let msg = await cmp(100, 100, [128, 128, 128, 255], [155, 155, 155, 255], { threshold: 0.1 })
        assert.ok(msg && /diff=10000px/.test(msg), msg)
    })

    it('[M08] 選項物件 pixelmatchOpt: { threshold:0.1, includeAA:false, checkerboard:true } 且已凍結', function() {
        assert.strict.deepEqual({ ...pixelmatchOpt }, { threshold: 0.1, includeAA: false, checkerboard: true })
        assert.strict.equal(Object.isFrozen(pixelmatchOpt), true)
    })

    it('[M09] src 內所有 pixelmatch 呼叫皆展開 pixelmatchOpt(不各自內嵌選項)', function() {
        let calls = []
        for (let f of fs.readdirSync(fdSrc).filter((s) => s.endsWith('.mjs'))) {
            let lines = fs.readFileSync(path.join(fdSrc, f), 'utf8').split(/\r?\n/)
            lines.forEach((line, i) => {
                let t = line.trim()
                if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('import ')) {
                    return
                }
                if (/\bpixelmatch\(/.test(line)) {
                    calls.push({ at: `${f}:${i + 1}`, ok: line.includes('...pixelmatchOpt') })
                }
            })
        }
        assert.ok(calls.length >= 5, `應找到至少 5 處 pixelmatch 呼叫, 實得 ${calls.length}`)
        assert.strict.deepEqual(calls.filter((c) => !c.ok).map((c) => c.at), [])
    })

    it('[M10] 各比對入口之度量一致: 黑對 24 級灰, writeBaselineIfChanged 與 compareImageDirs 皆計 10000 像素(7.x 為 0)', async function() {
        let dirA = path.join(fdTmp, 'dirA')
        let dirB = path.join(fdTmp, 'dirB')
        fs.mkdirSync(dirA, { recursive: true })
        fs.mkdirSync(dirB, { recursive: true })
        let bufBlack = await solid(100, 100, [0, 0, 0, 255])
        let bufGray = await solid(100, 100, [24, 24, 24, 255])
        fs.writeFileSync(path.join(dirA, 'x.png'), bufGray)
        fs.writeFileSync(path.join(dirB, 'x.png'), bufBlack)
        let r1 = compareImageDirs(dirA, dirB)
        assert.strict.equal(r1.files[0].numDiff, 10000)
        let r2 = await writeBaselineIfChanged(bufGray, path.join(dirB, 'x.png'), { keepSame: true, keepMaxDiff: 100, outPath: path.join(dirA, 'out.png'), writeFile: () => {} })
        assert.strict.deepEqual([r2.written, r2.numDiff], [true, 10000])
    })

})
