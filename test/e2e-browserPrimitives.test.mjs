import assert from 'assert'
import launchBrowser from '../src/launchBrowser.mjs'
import chromiumLaunchArgs from '../src/chromiumLaunchArgs.mjs'
import typeIntoInput from '../src/typeIntoInput.mjs'
import typeIntoNthInput from '../src/typeIntoNthInput.mjs'
import waitUntilExist from '../src/waitUntilExist.mjs'
import waitDrawerReady from '../src/waitDrawerReady.mjs'
import waitColResizeOverlay from '../src/waitColResizeOverlay.mjs'
import resetAgGridScroll from '../src/resetAgGridScroll.mjs'
import collectDomText from '../src/collectDomText.mjs'
import pageHasText from '../src/pageHasText.mjs'
import assertTextSpec from '../src/assertTextSpec.mjs'
import openCasePage from '../src/openCasePage.mjs'
import waitGridIdle from '../src/waitGridIdle.mjs'


//瀏覽器原語之無伺服器驗證: 真實Chromium(帶六旗標) + page.setContent, 不需任何後端或前端服務
//act一律走真鍵盤滑鼠(click/insertText), 頁面內之延遲變化以setTimeout模擬元件行為


describe('瀏覽器原語(無伺服器)', function() {
    this.timeout(120000)

    let browser = null
    let page = null

    before(async function() {
        browser = await launchBrowser()
    })
    after(async function() {
        if (browser) await browser.close()
    })
    beforeEach(async function() {
        let ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
        page = await ctx.newPage()
    })
    afterEach(async function() {
        if (page) await page.context().close()
    })

    it('launchBrowser: 以六旗標啟動無頭Chromium', async function() {
        assert.strict.deepStrictEqual(chromiumLaunchArgs.length, 6)
        assert.strict.ok(Object.isFrozen(chromiumLaunchArgs))
        await page.setContent('<div id="x">ok</div>')
        assert.strict.deepStrictEqual(await page.textContent('#x'), 'ok')
    })

    it('typeIntoInput: 受控輸入框(每次input事件重繪)一次注入正確, 既有值先清空', async function() {
        //模擬v-model: 每次input事件以新值重設value並重繪同層節點
        await page.setContent(`<input id="a" value="old-value"><div id="echo"></div>
            <script>
              let a = document.getElementById('a')
              a.addEventListener('input', () => { a.value = a.value; document.getElementById('echo').textContent = a.value })
            </script>`)
        await typeIntoInput(page, page.locator('#a'), 'Pw@login1-中文')
        assert.strict.deepStrictEqual(await page.inputValue('#a'), 'Pw@login1-中文')
        assert.strict.deepStrictEqual(await page.textContent('#echo'), 'Pw@login1-中文')
    })

    it('typeIntoInput: 焦點被父層mousedown.prevent攔截時拋錯(不靜默漏字)', async function() {
        await page.setContent(`<div id="wrap"><input id="a"></div>
            <script>document.getElementById('wrap').addEventListener('mousedown', (e) => e.preventDefault(), true)</script>`)
        await assert.rejects(typeIntoInput(page, page.locator('#a'), 'x'), /Timeout|timeout/)
    })

    it('typeIntoNthInput: 以索引定位第n個input', async function() {
        await page.setContent('<input><input value="zzz"><input>')
        await typeIntoNthInput(page, 1, '10.0.0.9')
        let vals = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map((e) => e.value))
        assert.strict.deepStrictEqual(vals, ['', '10.0.0.9', ''])
    })

    it('waitUntilExist: 條件成立即放行(可帶arg); 逾時拋出含對象描述之錯誤', async function() {
        await page.setContent('<div id="m"></div><script>setTimeout(() => { document.getElementById("m").textContent = "儲存成功" }, 300)</script>')
        await waitUntilExist(page, '訊息', (t) => document.body.innerText.includes(t), { arg: '儲存成功', timeout: 5000 })
        await assert.rejects(waitUntilExist(page, '不存在之元素', () => !!document.querySelector('#none'), { timeout: 300 }), /waitUntilExist 超過 300ms 仍找不到「不存在之元素」/)
    })

    it('waitUntilExist: async 判斷函數亦真正輪詢至成立(Playwright waitForFunction 會把 Promise 當 truthy 立即放行); 始終不成立即逾時拋錯', async function() {
        //反向對照: 直接用 waitForFunction + async 判斷, 條件為假仍立即放行(本缺陷之實證)
        await page.setContent('<div id="n">0</div><script>setTimeout(() => { document.getElementById("n").textContent = "2" }, 700)</script>')
        let t0 = Date.now()
        await page.waitForFunction(async () => document.getElementById('n').textContent === '2', null, { timeout: 5000 })
        assert.strict.ok(Date.now() - t0 < 500, 'waitForFunction 對 async 判斷應立即放行(否則此缺陷不存在)')
        assert.strict.equal(await page.textContent('#n'), '0', '放行時條件其實尚未成立')
        //waitUntilExist: 等到成立才放行
        await page.setContent('<div id="n">0</div><script>setTimeout(() => { document.getElementById("n").textContent = "2" }, 700)</script>')
        t0 = Date.now()
        await waitUntilExist(page, '成員數=2', async (want) => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return document.getElementById('n').textContent === want
        }, { arg: '2', timeout: 5000 })
        assert.strict.ok(Date.now() - t0 >= 600, `應等到條件成立, 實際${Date.now() - t0}ms`)
        await assert.rejects(waitUntilExist(page, '永不成立', async () => false, { timeout: 400 }), /waitUntilExist 超過 400ms 仍找不到「永不成立」/)
    })

    it('waitDrawerReady: [state]停在opening時等待, 轉為opened後放行; 無[state]元素立即放行', async function() {
        await page.setContent('<div>none</div>')
        let t0 = Date.now()
        await waitDrawerReady(page)
        assert.strict.ok(Date.now() - t0 < 1000)
        await page.setContent('<div id="d" state="opening"></div><div state="hidden"></div><script>setTimeout(() => document.getElementById("d").setAttribute("state", "opened"), 600)</script>')
        t0 = Date.now()
        await waitDrawerReady(page)
        let dt = Date.now() - t0
        assert.strict.ok(dt >= 450, `應等到轉為opened, 實際${dt}ms`)
        assert.strict.deepStrictEqual(await page.getAttribute('#d', 'state'), 'opened')
    })

    it('waitDrawerReady: 逾時不拋錯(交由連拍穩定兜底)', async function() {
        await page.setContent('<div state="hiding"></div>')
        await waitDrawerReady(page, { timeout: 300 })
    })

    it('waitColResizeOverlay: 拖曳分隔條opacity由0轉1後放行; 無此元素立即放行; 逾時不拋錯', async function() {
        await page.setContent('<div id="b" style="cursor: col-resize; opacity: 0; width:5px; height:50px"></div><script>setTimeout(() => { document.getElementById("b").style.opacity = "1" }, 500)</script>')
        let t0 = Date.now()
        await waitColResizeOverlay(page)
        assert.strict.ok(Date.now() - t0 >= 400)
        assert.strict.deepStrictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('b')).opacity), '1')
        await page.setContent('<div>none</div>')
        t0 = Date.now()
        await waitColResizeOverlay(page)
        assert.strict.ok(Date.now() - t0 < 1000)
        await page.setContent('<div style="cursor:col-resize; opacity: 0.5"></div>')
        await waitColResizeOverlay(page, { timeout: 300 })
    })

    it('collectDomText / pageHasText: 走訪文字節點(略過 script/style/noscript, 不判可見性); 跨節點字串不命中', async function() {
        await page.setContent(`<div>儲存金鑰數據成功</div><div style="display:none">hidden-text</div>
            <script>let x = 'in-script'</script><style>.a{}</style><p>Save <b>tokens</b></p>`)
        assert.strict.equal(await pageHasText(page, '儲存金鑰數據成功'), true)
        assert.strict.equal(await pageHasText(page, 'hidden-text'), true)
        assert.strict.equal(await pageHasText(page, 'in-script'), false)
        assert.strict.equal(await pageHasText(page, 'Save tokens'), false)
        assert.strict.equal(await collectDomText(page), '儲存金鑰數據成功 | hidden-text | Save | tokens')
        assert.strict.equal(await collectDomText(page, { sep: '/', maxLen: 10 }), '儲存金鑰數據成功/h')
    })

    it('assertTextSpec: text 須含、absentText 不得含; 不符時錯誤訊息附標籤與頁面文字', async function() {
        await page.setContent('<div>Save tokens successfully</div>')
        await assertTextSpec(page, { mode: 'text', value: 'Save tokens successfully' }, { label: 'E2E-002' })
        await assertTextSpec(page, { mode: 'absentText', value: 'Failed' })
        await assert.rejects(assertTextSpec(page, { mode: 'text', value: 'Failed to save' }, { label: 'E2E-004' }), /預期含 "Failed to save" \(E2E-004\), 實際: Save tokens successfully/)
        await assert.rejects(assertTextSpec(page, { mode: 'absentText', value: 'Save' }, { label: 'x' }), /預期不含 "Save" \(x\)/)
        await assert.rejects(assertTextSpec(page, { mode: 'oops', value: 'a' }), /spec.mode/)
    })

    it('openCasePage: 新 context 之頁面, 預設自動接受 confirm; onDialog=dismiss 則取消', async function() {
        let askConfirm = () => {
            document.getElementById('r').textContent = String(window.confirm('ok?'))
        }
        let p1 = await openCasePage(browser)
        await p1.setContent('<div id="r"></div>')
        await p1.evaluate(askConfirm)
        assert.strict.equal(await p1.textContent('#r'), 'true')
        await p1.context().close()
        let p2 = await openCasePage(browser, { onDialog: 'dismiss', contextOptions: { viewport: { width: 640, height: 480 } } })
        await p2.setContent('<div id="r"></div>')
        await p2.evaluate(askConfirm)
        assert.strict.equal(await p2.textContent('#r'), 'false')
        assert.strict.deepStrictEqual(p2.viewportSize(), { width: 640, height: 480 })
        await p2.context().close()
    })

    it('waitGridIdle: 內容持續變動時等待, 靜止滿 stableMs 才放行; 無表格立即放行; requireSelector 未出現即逾時拋錯', async function() {
        //模擬表格: 前 900ms 每 100ms 改一次首列文字, 之後靜止
        await page.setContent(`<div class="ag-header" style="height:20px"></div>
            <div class="ag-center-cols-viewport" style="width:300px; overflow:auto"><div class="ag-center-cols-container">
              <div class="ag-row" row-index="0"><div class="ag-cell" col-id="a" id="c">0</div></div></div></div>
            <script>let n = 0; let t = setInterval(() => { document.getElementById('c').textContent = String(++n); if (n >= 9) clearInterval(t) }, 100)</script>`)
        let t0 = Date.now()
        await waitGridIdle(page, { stableMs: 500 })
        let dt = Date.now() - t0
        assert.strict.ok(dt >= 1100, `應等到變動停止後再滿 500ms, 實際${dt}ms`)
        assert.strict.equal(await page.textContent('#c'), '9')
        await page.setContent('<div>no grid</div>')
        t0 = Date.now()
        await waitGridIdle(page)
        assert.strict.ok(Date.now() - t0 < 500)
        await page.setContent('<div class="ag-center-cols-viewport"><div class="ag-cell">x</div></div>')
        await assert.rejects(waitGridIdle(page, { requireSelector: '.ag-header-cell[col-id="token"]', timeout: 400 }), /waitGridIdle 超過 400ms/)
    })

    it('waitGridIdle: 版面位移(內容文字不變)亦視為未靜止', async function() {
        await page.setContent(`<div class="ag-header"></div>
            <div class="ag-center-cols-viewport" style="width:300px"><div class="ag-center-cols-container" id="cc" style="position:relative; left:0">
              <div class="ag-row" row-index="0"><div class="ag-cell" col-id="a">same</div></div></div></div>
            <script>let n = 0; let t = setInterval(() => { document.getElementById('cc').style.left = (++n) + 'px'; if (n >= 8) clearInterval(t) }, 100)</script>`)
        let t0 = Date.now()
        await waitGridIdle(page, { stableMs: 400 })
        assert.strict.ok(Date.now() - t0 >= 900, '文字不變但幾何在動, 須等到位移停止')
    })

    it('waitGridIdle: minCells>0 時表格尚未出現視為未就緒, 等表格出現且格數足夠後再靜止才放行; 始終未出現即逾時拋錯', async function() {
        //表格 600ms 後才出現(模擬登入後才掛載之清單)
        await page.setContent(`<div id="root"></div>
            <script>setTimeout(() => { document.getElementById('root').innerHTML = '<div class="ag-header"></div><div class="ag-center-cols-viewport"><div class="ag-center-cols-container"><div class="ag-row" row-index="0"><div class="ag-cell" col-id="a">1</div><div class="ag-cell" col-id="b">2</div></div></div></div>' }, 600)</script>`)
        let t0 = Date.now()
        await waitGridIdle(page, { minCells: 2, stableMs: 300 })
        assert.strict.ok(Date.now() - t0 >= 850, `應等表格出現(600ms)後再靜止 300ms, 實際${Date.now() - t0}ms`)
        await page.setContent('<div>no grid</div>')
        await assert.rejects(waitGridIdle(page, { minCells: 1, timeout: 400 }), /waitGridIdle 超過 400ms/)
    })

    it('resetAgGridScroll: 表格水平捲動歸零', async function() {
        await page.setContent(`<div class="ag-body-horizontal-scroll-viewport" style="width:200px; overflow-x:scroll"><div style="width:2000px; height:10px"></div></div>
            <div class="ag-center-cols-viewport" style="width:200px; overflow-x:scroll"><div style="width:2000px; height:10px"></div></div>
            <script>document.querySelectorAll('div[class^="ag-"]').forEach((e) => { e.scrollLeft = 300 })</script>`)
        assert.strict.deepStrictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('div[class^="ag-"]')).map((e) => e.scrollLeft)), [300, 300])
        await resetAgGridScroll(page, { settleMs: 50 })
        assert.strict.deepStrictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('div[class^="ag-"]')).map((e) => e.scrollLeft)), [0, 0])
    })

})
