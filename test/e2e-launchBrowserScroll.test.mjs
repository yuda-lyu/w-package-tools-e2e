import assert from 'assert'
import launchBrowser from '../src/launchBrowser.mjs'


//規則帳本 sgud/rule/rulebook_launch.md R-LB-7(旗標組含 --disable-smooth-scrolling: 鍵盤與滾輪之捲動即時到位, 測試讀到目標位置後立即按鍵不受動畫相位影響)
//  真瀏覽器(headless shell); 以捲動事件(onscroll)記錄鍵盤捲動之各中間位置, 事件同步(等捲動抵達終點), 不以固定延時
//  本檔證明兩件事: ①launchBrowser 之預設啟動下鍵盤捲動直接到位(無中間位置); ②量測方法有鑑別力(對照組以 --enable-smooth-scrolling 啟動時出現中間位置)
//  旗標本身送達瀏覽器命令列由 api-launchBrowserWiring [LB07] 以實際命令列驗證; 於本機 Chromium 159 之 headless shell, 預設已為非平滑
//  (旗標之作用是使結果不隨主機之作業系統動畫設定而變, 本機之設定未改動, 故①於旗標有無下皆綠, 契約由 [LB00]、[LB07] 守住)


let HTML = '<!doctype html><body style="margin:0"><div id="sc" tabindex="0" style="height:300px;overflow:auto"><div style="height:6000px"></div></div></body>'


//按下鍵後記錄捲動容器之捲動位置序列, 等捲動抵達 target(scrollTop 為 'bottom' 或 0)後回傳序列
async function pressAndRecord(page, key, target) {
    await page.evaluate(() => {
        let el = document.getElementById('sc')
        window.__pos = []
        el.onscroll = () => window.__pos.push(Math.round(el.scrollTop))
        el.focus()
    })
    await page.keyboard.press(key)
    await page.waitForFunction((t) => {
        let el = document.getElementById('sc')
        return t === 'bottom' ? el.scrollTop >= el.scrollHeight - el.clientHeight - 1 : el.scrollTop <= 1
    }, target, { timeout: 20000 })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))) //再過兩幀, 使抵達終點後之事件皆已記錄
    return await page.evaluate(() => window.__pos.slice())
}


describe('e2e-launchBrowserScroll', function() {
    this.timeout(120000)

    let browser = null

    afterEach(async function() {
        if (browser) {
            await browser.close().catch(() => {})
        }
        browser = null
    })

    it('[SS01] launchBrowser 預設啟動: Ctrl+End、Ctrl+Home 之鍵盤捲動皆即時到位(捲動事件之位置只有終點, 無中間位置)', async function() {
        browser = await launchBrowser()
        let page = await browser.newPage()
        await page.setContent(HTML)
        let end = await pressAndRecord(page, 'Control+End', 'bottom')
        let top = Math.max(...end)
        assert.ok(top >= 5000, '應已捲到底: ' + JSON.stringify(end))
        assert.deepStrictEqual([...new Set(end)], [top], '捲到底之過程不得有中間位置: ' + JSON.stringify(end))
        let home = await pressAndRecord(page, 'Control+Home', 0)
        assert.deepStrictEqual([...new Set(home)], [0], '回到頂之過程不得有中間位置: ' + JSON.stringify(home))
    })

    it('[SS02] 量測有鑑別力(對照組): 以 --enable-smooth-scrolling 啟動時, 同一鍵盤捲動之捲動事件出現中間位置(證明 [SS01] 之「無中間位置」不是量測失靈)', async function() {
        browser = await launchBrowser({ args: ['--enable-smooth-scrolling'] })
        let page = await browser.newPage()
        await page.setContent(HTML)
        let end = await pressAndRecord(page, 'Control+End', 'bottom')
        let top = Math.max(...end)
        assert.ok(end.some((p) => p > 0 && p < top), '平滑捲動應有中間位置: ' + JSON.stringify(end))
    })

})
