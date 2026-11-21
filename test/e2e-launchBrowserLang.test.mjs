import assert from 'assert'
import launchBrowser from '../src/launchBrowser.mjs'
import withHostLang from './tools/withHostLang.mjs'


//launchBrowser 之語系旗標(--lang=zh-TW)之真瀏覽器驗證(本套件帳本 sgud/rule/rulebook_launch.md R-LB-6; 排程第 585 項)
//背景: Chromium 159(headless shell revision 1255)起不再繼承主機系統語系(應用程式語系預設 en-US), generic 字族(sans-serif)之字型隨語系改變:
//      Windows 繁中主機上拉丁字由微軟正黑體變 Arial、中文字由微軟正黑體變 Microsoft YaHei(簡體字形)。旗標組固定 --lang=zh-TW 後字型不隨主機語系而變
//作法: 以 Intl.DateTimeFormat 替身模擬不同之主機系統語系(w-playwright 於呼叫端未自給語系時依其補入--lang; 其每次合併時才讀取、不快取), 經 launchBrowser 真啟動 headless shell,
//      讀 navigator.language 與 CDP CSS.getPlatformFontsForNode 之 sans-serif 實際字型; 並以呼叫端自給語系(opt.args、opt.lang)對照, 證明本檢測有鑑別力(語系不同則字型不同)
//本檔只啟動 headless shell(無頭、未給通道), 不啟動真 Chrome、Edge、完整 Chromium; 字型斷言僅限 Windows(Windows 內建之微軟正黑體、Arial、Microsoft YaHei), 其他平台只驗 navigator.language


//RE_JHENG, 微軟正黑體之 CDP 字型家族名(隨系統顯示語言為在地名 '微軟正黑體' 或原名 'Microsoft JhengHei')
let RE_JHENG = /^(微軟正黑體|Microsoft JhengHei)$/i


//measure, 於已啟動之瀏覽器載入含中文與拉丁字之頁面(字族皆為 sans-serif), 回傳 navigator.language、兩段文字之 CDP 實際字型家族名、文字方塊尺寸
async function measure(browser) {
    let ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
    try {
        let page = await ctx.newPage()
        await page.setContent('<div id="cjk" style="font-family:sans-serif;font-size:14px;display:inline-block">中文字測試</div><br><div id="lat" style="font-family:sans-serif;font-size:14px;display:inline-block">Abc xyz</div>')
        let nav = await page.evaluate(() => navigator.language)
        let cdp = await ctx.newCDPSession(page)
        await cdp.send('DOM.enable')
        await cdp.send('CSS.enable')
        let doc = await cdp.send('DOM.getDocument')
        let fonts = {}
        for (let id of ['cjk', 'lat']) {
            let q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `#${id}` })
            let f = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: q.nodeId })
            fonts[id] = f.fonts.map((x) => x.familyName)
        }
        let size = await page.evaluate(() => {
            let r = (id) => {
                let b = document.getElementById(id).getBoundingClientRect()
                return [b.width, b.height]
            }
            return { cjk: r('cjk'), lat: r('lat') }
        })
        return { nav, fonts, size }
    }
    finally {
        await ctx.close()
    }
}


//run, 於模擬之主機語系 host 下以 opt 經 launchBrowser 啟動、量測、關閉
async function run(host, opt) {
    let browser = await withHostLang(host, () => launchBrowser(opt))
    try {
        return await measure(browser)
    }
    finally {
        await browser.close()
    }
}


describe('launchBrowser 之語系旗標(真瀏覽器)', function() {
    this.timeout(120000)

    it('[LL01] 主機系統語系為en-US(模擬)時launchBrowser()仍得navigator.language=zh-TW, 且sans-serif之中文字與拉丁字皆為微軟正黑體(Windows; 修前為en-US、Microsoft YaHei與Arial)', async function() {
        let r = await run('en-US')

        //R-LB-6: 應用程式語系固定為 zh-TW(不隨主機語系)
        assert.strict.equal(r.nav, 'zh-TW')

        //R-LB-6: generic 字族 sans-serif 解析為微軟正黑體(中文字與拉丁字); 其他平台無此字型, 不斷言
        if (process.platform === 'win32') {
            assert.strict.ok(r.fonts.cjk.length > 0 && r.fonts.cjk.every((f) => RE_JHENG.test(f)), `cjk fonts: ${JSON.stringify(r.fonts.cjk)}`)
            assert.strict.ok(r.fonts.lat.length > 0 && r.fonts.lat.every((f) => RE_JHENG.test(f)), `latin fonts: ${JSON.stringify(r.fonts.lat)}`)
        }
    })

    it('[LL02] 結果不隨主機系統語系而變: 模擬主機語系為zh-TW、en-US、ja-JP、de-DE時, navigator.language、字型家族與文字方塊尺寸逐項相同', async function() {
        let rs = []
        for (let host of ['zh-TW', 'en-US', 'ja-JP', 'de-DE']) {
            rs.push({ host, r: await run(host) })
        }

        //R-LB-6: 四個主機語系之量測結果逐項相同(以第一個為準)
        for (let x of rs) {
            assert.strict.deepEqual(x.r, rs[0].r, `host ${x.host} differs from host ${rs[0].host}`)
        }
        assert.strict.equal(rs[0].r.nav, 'zh-TW')
    })

    it('[LL03] 呼叫端經opt.args自給--lang=en-US(主機語系模擬為zh-TW)時以呼叫端為準: navigator.language=en-US, 字型不再是微軟正黑體(Windows); 與預設結果不同, 證明[LL01]之檢測有鑑別力', async function() {
        let dflt = await run('zh-TW')
        let r = await run('zh-TW', { args: ['--lang=en-US'] })

        //R-LB-6: 以呼叫端為準
        assert.strict.equal(r.nav, 'en-US')
        assert.strict.equal(dflt.nav, 'zh-TW')

        //鑑別力: 語系不同則 sans-serif 之實際字型不同(Windows 上拉丁字 Arial、中文字 Microsoft YaHei, 非微軟正黑體)
        if (process.platform === 'win32') {
            assert.strict.ok(r.fonts.cjk.every((f) => !RE_JHENG.test(f)), `cjk fonts: ${JSON.stringify(r.fonts.cjk)}`)
            assert.strict.ok(r.fonts.lat.every((f) => !RE_JHENG.test(f)), `latin fonts: ${JSON.stringify(r.fonts.lat)}`)
            assert.strict.notDeepEqual(r.fonts, dflt.fonts)
        }
    })

    it('[LL04] 呼叫端給opt.lang=ja-JP時以呼叫端為準(Chromium正規化為ja), 不再是zh-TW', async function() {
        let r = await run('en-US', { lang: 'ja-JP' })
        assert.strict.equal(r.nav, 'ja')
    })

})
