import assert from 'assert'
import launchBrowser from '../src/launchBrowser.mjs'
import probeStuckTooltip from '../src/probeStuckTooltip.mjs'


//probeStuckTooltip之無伺服器驗證: 真實Chromium + page.setContent, 頁面內以純物件模擬Vue 2元件樹($root/$children/$refs/$props/valueTrans),
//不需Vue與w-component-vue; 可見性以真實DOM之display/visibility/尺寸判定


//頁面: 三個提示元素(tip-a/tip-b/pop-a)與一個掛__vue__之應用根元素; 元件樹由各案例以 build(spec) 建立
let html = `
<div id="app"></div>
<div id="tip-a" style="position:fixed; left:10px; top:10px; width:80px; height:20px;">Save changes</div>
<div id="tip-b" style="position:fixed; left:10px; top:40px; width:80px; height:20px;">Delete</div>
<div id="pop-a" style="position:fixed; left:10px; top:70px; width:80px; height:60px;">list</div>
<script>
    //spec: [{ id, mode, valueTrans }], 各項為WTooltip結構之模擬實例, 皆掛於同一根實例之下
    window.build = (spec, useVo) => {
        let mk = (s) => ({
            $refs: { divTrigger: document.createElement('div'), divContent: document.getElementById(s.id) },
            $props: { mode: s.mode },
            valueTrans: s.valueTrans,
            $children: [],
        })
        let root = { $refs: {}, $props: {}, $children: [{ $refs: {}, $props: {}, $children: spec.map(mk) }] }
        root.$root = root
        if (useVo) {
            window.$vo = { $root: root }
        }
        else {
            delete window.$vo
            document.getElementById('app').__vue__ = root
        }
    }
</script>`


describe('probeStuckTooltip(無伺服器)', function() {
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
        await page.setContent(html)
    })
    afterEach(async function() {
        if (page) await page.context().close()
    })

    it('hover型提示框仍顯示: 拋錯且訊息列出全部殘留文字', async function() {
        await page.evaluate(() => window.build([{ id: 'tip-a', mode: 'tooltip', valueTrans: true }, { id: 'tip-b', mode: 'tooltip', valueTrans: true }]))
        await assert.rejects(probeStuckTooltip(page), (err) => {
            assert.strict.ok(err.message.includes('「Save changes」「Delete」'), err.message)
            return true
        })
    })

    it('點開型浮層(mode=popup)顯示中: 不視為殘留', async function() {
        await page.evaluate(() => window.build([{ id: 'pop-a', mode: 'popup', valueTrans: true }]))
        assert.strict.deepStrictEqual(await probeStuckTooltip(page), [])
    })

    it('hover型提示框未顯示(valueTrans=false): 不視為殘留', async function() {
        await page.evaluate(() => window.build([{ id: 'tip-a', mode: 'tooltip', valueTrans: false }]))
        assert.strict.deepStrictEqual(await probeStuckTooltip(page), [])
    })

    it('display:none或visibility:hidden(reference-hidden)或零尺寸: 非畫面可見, 不視為殘留', async function() {
        await page.evaluate(() => {
            document.getElementById('tip-a').style.display = 'none'
            document.getElementById('tip-b').style.visibility = 'hidden'
            document.getElementById('pop-a').style.cssText = 'position:fixed; width:0; height:0; overflow:hidden;'
            window.build([{ id: 'tip-a', mode: 'tooltip', valueTrans: true }, { id: 'tip-b', mode: 'tooltip', valueTrans: true }, { id: 'pop-a', mode: 'tooltip', valueTrans: true }])
        })
        assert.strict.deepStrictEqual(await probeStuckTooltip(page), [])
    })

    it('根實例: window.$vo優先, 無則取body直屬元素之__vue__, 皆無則不檢查', async function() {
        await page.evaluate(() => window.build([{ id: 'tip-a', mode: 'tooltip', valueTrans: true }], true))
        await assert.rejects(probeStuckTooltip(page), /Save changes/)
        await page.evaluate(() => window.build([{ id: 'tip-b', mode: 'tooltip', valueTrans: true }], false))
        await assert.rejects(probeStuckTooltip(page), /Delete/)
        await page.evaluate(() => {
            delete window.$vo
            delete document.getElementById('app').__vue__
        })
        assert.strict.deepStrictEqual(await probeStuckTooltip(page), [])
    })

    it('opt.rootSel與opt.createError: 指定根元素(優先於window.$vo)與自訂錯誤物件', async function() {
        //#app 掛有含殘留之元件樹; window.$vo 為另一空樹(無提示框)
        await page.evaluate(() => {
            window.build([{ id: 'tip-a', mode: 'tooltip', valueTrans: true }], false)
            let empty = { $refs: {}, $props: {}, $children: [] }
            empty.$root = empty
            window.$vo = { $root: empty }
        })
        assert.strict.deepStrictEqual(await probeStuckTooltip(page), [], '未給 rootSel 時取 window.$vo(空樹)')
        await assert.rejects(probeStuckTooltip(page, {
            rootSel: '#app',
            createError: (texts) => Object.assign(new Error('custom'), { texts }),
        }), (err) => {
            assert.strict.deepStrictEqual([err.message, err.texts], ['custom', ['Save changes']])
            return true
        })
        assert.strict.deepStrictEqual(await probeStuckTooltip(page, { rootSel: '#none' }), [], 'rootSel 找不到元素則不檢查')
    })

})
