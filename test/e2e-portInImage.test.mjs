import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import launchBrowser from '../src/launchBrowser.mjs'
import captureStable from '../src/captureStable.mjs'
import overlayRegions from '../src/overlayRegions.mjs'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'
import { assertE2eBasePort } from '../src/reserveE2ePorts.mjs'


//畫面含埠之流程(規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E7): 比對端覆蓋該處, 或標記只能在基準埠跑。真實 Chromium、真實截圖; 頁面以 setContent 模擬畫面顯示網址, 不需任何服務。
//標準圖只存在 test/_tmp/portInImage/(本檔自產自比, 不入 test/pics, 不動任何既有標準圖)。


let fd = path.resolve('test/_tmp/portInImage')
let fpBase = path.join(fd, 'base.png')
let BASE = 19640


function html(port, note = '使用者資料') {
    return `<!doctype html><html><body style="margin:20px;font:16px sans-serif;background:#fff">
<div id="title">${note}</div>
<div id="row">轉址: <span id="url">http://127.0.0.1:${port}/?view=user</span></div>
<div id="foot">最後更新: 固定文字</div>
</body></html>`
}


function countDiff(a, b) {
    let x = PNG.sync.read(a)
    let y = PNG.sync.read(b)
    assert.strict.deepEqual([x.width, x.height], [y.width, y.height])
    return pixelmatch(x.data, y.data, null, x.width, x.height, { threshold: 0.1, includeAA: false })
}


describe('畫面含埠之流程', function() {

    this.timeout(120000)

    let browser = null
    let page = null

    //比對端覆蓋之寫法: 與截圖同一畫面狀態下量含埠之矩形(外擴數 px, 埠位數相同而字寬略異者涵蓋到行尾), 以標準圖同座標內容覆蓋
    async function coverPort(buf, refBuf) {
        let box = await page.locator('#url').boundingBox()
        return overlayRegions(buf, [{ x: box.x - 3, y: box.y - 3, w: box.width + 40, h: box.height + 6 }], refBuf)
    }

    async function shot(port, note) {
        await page.setContent(html(port, note))
        return captureStable(page, { initialWaitMs: 50 })
    }

    before(async function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        browser = await launchBrowser()
        let ctx = await browser.newContext({ viewport: { width: 600, height: 200 } })
        page = await ctx.newPage()
        fs.writeFileSync(fpBase, await shot(BASE))
    })

    after(async function() {
        if (browser) {
            await browser.close()
        }
        fs.rmSync(fd, { recursive: true, force: true })
    })

    //E7: 全綠不能證明畫面不含埠(差異可能低於容差)
    it('[PI1] 不覆蓋時位移後之畫面確有差異, 且低於預設容差: 比對照樣通過(假綠), 故不能以全綠判定畫面不含埠', async function() {
        let buf = await shot(BASE + 100)
        let n = countDiff(buf, fs.readFileSync(fpBase))
        assert.strict.ok(n > 0, `位移後應有差異, 實得 ${n}`)
        assert.strict.ok(n <= 100, `此畫面之差異低於預設容差 100, 實得 ${n}`)
        assert.doesNotThrow(() => assertBaselineMatch(buf, fpBase, 'pi1', { warn: () => {} }))
    })

    //E7: 比對端覆蓋該處
    it('[PI2] 比對端覆蓋: 位移後像素差異為 0(容差 0 亦通過); 被覆蓋之值另以語意斷言驗證為實際埠', async function() {
        let port = BASE + 100
        let buf = await shot(port)
        let refBuf = fs.readFileSync(fpBase)
        let covered = await coverPort(buf, refBuf)
        assert.strict.equal(countDiff(covered, refBuf), 0)
        assert.doesNotThrow(() => assertBaselineMatch(covered, fpBase, 'pi2', { maxDiffPixels: 0, warn: () => {} }))
        assert.strict.equal(await page.textContent('#url'), `http://127.0.0.1:${port}/?view=user`)
    })

    it('[PI3] 比對端覆蓋不掩蓋覆蓋區外之真差異: 其他文字改變仍超過容差 0 而失敗', async function() {
        let buf = await shot(BASE + 100, '另一個標題')
        let refBuf = fs.readFileSync(fpBase)
        let covered = await coverPort(buf, refBuf)
        assert.strict.ok(countDiff(covered, refBuf) > 0)
        assert.throws(() => assertBaselineMatch(covered, fpBase, 'pi3', { maxDiffPixels: 0, pendingDir: path.join(fd, 'pending'), warn: () => {} }))
    })

    //E7: 標記只能在基準埠跑
    it('[PI4] 只能在基準埠跑: assertE2eBasePort 於位移實例拋錯, 不產生假綠', function() {
        assert.strict.equal(assertE2eBasePort('flow', { env: {} }), undefined)
        assert.throws(() => assertE2eBasePort('flow', { env: { E2E_PORT_OFFSET: '100' } }), /只能在基準埠跑/)
    })

})
