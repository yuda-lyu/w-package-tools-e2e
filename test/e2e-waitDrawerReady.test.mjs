import assert from 'assert'
import launchBrowser from '../src/launchBrowser.mjs'
import waitDrawerReady from '../src/waitDrawerReady.mjs'


//waitDrawerReady 只認WDrawer根節點(Gitea #35): 真實Chromium + 以頁面內腳本掛載各元件根節點, 不需任何伺服器
//  契約(函數說明): 只等WDrawer; 頁面無WDrawer時立即放行; 逾時(預設10000ms)不拋錯
//  opt為選填, 給了就檢測, 非預期之輸入視為未給改用預設而不拋錯(dspec〈輸入參數之檢測機制〉K3); opt.debug為true時才警告(固定詞彙, 不含傳入之值)
//  w-component-vue 2.5.35起WDialog、WTooltip／WPopup／WTextSelect之浮層(.WPopperFix)、WGroupDragdrop、WGroupTags、WListExpandItem之根節點亦帶state屬性
//  根節點之屬性集取自2.5.35 dist實際渲染之DOM(唯讀載入其umd掛載各元件後逐一傾印, 2026-11-01), 並如Vue以setAttribute寫入(camelCase名稱由HTML文件轉小寫):
//    WDrawer          state(hidden/opening/opened/hiding) + changeValue + changeDrawerWidth + changeAfloat, 無固定class
//    WDialog          state(hidden/opening/opened/resizing) + changeParam
//    浮層(.WPopperFix) state(hidden/opening/opened) + class="WPopperFix", Teleport至body下
//    WListExpandItem  state(collapsed/expanding/expanded/collapsing) + changeActive
//    WGroupTags、WGroupDragdrop  state(idle/moving) + changeValue
//  等待之時機以事件同步: 由測試翻轉state屬性, 再等waitDrawerReady結束; 「仍在等待」之否定斷言才用短暫觀察窗


//各元件根節點之屬性集(值為預設屬性, state另給)
let KINDS = {
    WDrawer: { attrs: { changeValue: '', changeDrawerWidth: '', changeAfloat: '' }, states: ['hidden', 'opening', 'opened', 'hiding'] },
    WDialog: { attrs: { changeParam: '' }, states: ['hidden', 'opening', 'opened', 'resizing'] },
    WPopperFix: { attrs: { class: 'WPopperFix' }, states: ['hidden', 'opening', 'opened'] },
    WListExpandItem: { attrs: { changeActive: '' }, states: ['collapsed', 'expanding', 'expanded', 'collapsing'] },
    WGroupTags: { attrs: { changeValue: '' }, states: ['idle', 'moving'] },
    WGroupDragdrop: { attrs: { changeValue: '' }, states: ['idle', 'moving'] },
}

//OTHERS, 2.5.35新增state之非WDrawer元件
let OTHERS = Object.keys(KINDS).filter((k) => k !== 'WDrawer')


describe('waitDrawerReady 只認WDrawer根節點', function() {
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

    //mount, 掛載根節點; items為[{ id, kind, state }], 屬性集取KINDS[kind].attrs, 以setAttribute寫入(同Vue)
    let mount = async (items) => {
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.evaluate(({ items, kinds }) => {
            for (let it of items) {
                let e = document.createElement('div')
                e.id = it.id
                for (let [k, v] of Object.entries(kinds[it.kind].attrs)) {
                    e.setAttribute(k, v)
                }
                e.setAttribute('state', it.state)
                document.body.appendChild(e)
            }
        }, { items, kinds: KINDS })
    }

    //setState, 翻轉元素之state屬性(模擬元件過場落定)
    let setState = async (id, state) => {
        await page.evaluate(([i, s]) => document.getElementById(i).setAttribute('state', s), [id, state])
    }

    //getState, 讀元素之state屬性
    let getState = async (id) => {
        return await page.evaluate((i) => document.getElementById(i).getAttribute('state'), id)
    }

    //startWait, 啟動waitDrawerReady並追蹤是否已結束(t.done)與耗時(t.ms)
    let startWait = (opt) => {
        let t = { done: false, ms: null, err: null, t0: Date.now() }
        t.p = waitDrawerReady(page, opt)
            .catch((e) => {
                t.err = e
            })
            .then(() => {
                t.done = true
                t.ms = Date.now() - t.t0
            })
        return t
    }

    //observe, 否定斷言用之短暫觀察窗(poll週期100ms, 觀察6個週期)
    let observe = async () => {
        await page.waitForTimeout(600)
    }

    //逾時上限與「立即放行」之界: 立即放行約百毫秒, 誤等則須等到逾時, 兩者差一個數量級以上
    let TIMEOUT = 4000
    let IMMEDIATE = 2000

    describe('輸入空間: 他種元件 × 狀態值 × 抽屜情境(只依WDrawer判定)', function() {

        //[WDrawer 情境] 對應函數說明「只認WDrawer根節點」「頁面無WDrawer時立即放行」
        let ctxs = [
            { name: '頁面無WDrawer', drawers: [] },
            { name: 'WDrawer為opened', drawers: [{ id: 'dr', kind: 'WDrawer', state: 'opened' }] },
            { name: 'WDrawer為hidden', drawers: [{ id: 'dr', kind: 'WDrawer', state: 'hidden' }] },
        ]

        for (let kind of OTHERS) {
            for (let state of KINDS[kind].states) {
                for (let c of ctxs) {
                    it(`${kind} 之state=${state}, ${c.name}: 立即放行`, async function() {
                        await mount([...c.drawers, { id: 'ot', kind, state }])
                        let t = startWait({ timeout: TIMEOUT })
                        await t.p
                        assert.strict.ok(t.err === null)
                        assert.strict.ok(t.ms < IMMEDIATE, `他種元件不應影響判定, 實際等了${t.ms}ms(逾時${TIMEOUT}ms)`)
                        assert.strict.deepStrictEqual(await getState('ot'), state) //未被改動
                    })
                }
            }
        }

        it('多種元件同時處於過渡態(WDialog opening、浮層opening、WListExpandItem expanding、WGroupTags moving)且WDrawer為opened: 立即放行', async function() {
            await mount([
                { id: 'dr', kind: 'WDrawer', state: 'opened' },
                { id: 'a', kind: 'WDialog', state: 'opening' },
                { id: 'b', kind: 'WPopperFix', state: 'opening' },
                { id: 'c', kind: 'WListExpandItem', state: 'expanding' },
                { id: 'd', kind: 'WGroupTags', state: 'moving' },
                { id: 'e', kind: 'WGroupDragdrop', state: 'moving' },
            ])
            let t = startWait({ timeout: TIMEOUT })
            await t.p
            assert.strict.ok(t.ms < IMMEDIATE, `實際等了${t.ms}ms`)
        })
    })

    describe('WDrawer過渡態時仍等待至穩定態', function() {

        it('WDrawer opening: 等待; 其落定為opened後放行', async function() {
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'opening' }])
            let t = startWait({ timeout: 8000 })
            await observe()
            assert.strict.ok(!t.done, 'WDrawer仍在opening, 不應放行')
            await setState('dr', 'opened')
            await t.p
            assert.strict.ok(t.err === null)
            assert.strict.ok(t.ms < 4000, `落定後應即放行, 實際共${t.ms}ms`)
        })

        it('WDrawer hiding: 等待; 其落定為hidden後放行', async function() {
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'hiding' }])
            let t = startWait({ timeout: 8000 })
            await observe()
            assert.strict.ok(!t.done, 'WDrawer仍在hiding, 不應放行')
            await setState('dr', 'hidden')
            await t.p
            assert.strict.ok(t.ms < 4000, `落定後應即放行, 實際共${t.ms}ms`)
        })

        it('WDrawer opening 且他種元件停在過渡態: 只等WDrawer, WDrawer落定即放行(他種元件仍在過渡)', async function() {
            await mount([
                { id: 'dr', kind: 'WDrawer', state: 'opening' },
                { id: 'a', kind: 'WDialog', state: 'opening' },
                { id: 'b', kind: 'WPopperFix', state: 'opening' },
            ])
            let t = startWait({ timeout: 8000 })
            await observe()
            assert.strict.ok(!t.done, 'WDrawer仍在opening, 不應放行')
            await setState('dr', 'opened')
            await t.p
            assert.strict.ok(t.ms < 4000, `WDrawer落定後不應再等他種元件, 實際共${t.ms}ms`)
            assert.strict.deepStrictEqual([await getState('a'), await getState('b')], ['opening', 'opening'])
        })

        it('多個WDrawer: 全部落定才放行(一個opened、一個opening)', async function() {
            await mount([
                { id: 'd1', kind: 'WDrawer', state: 'opened' },
                { id: 'd2', kind: 'WDrawer', state: 'opening' },
            ])
            let t = startWait({ timeout: 8000 })
            await observe()
            assert.strict.ok(!t.done, '仍有WDrawer在opening, 不應放行')
            await setState('d2', 'opened')
            await t.p
            assert.strict.ok(t.ms < 4000, `實際共${t.ms}ms`)
        })

        it('WDrawer停在opening且逾時: 不拋錯, 等滿逾時才回(他種元件為opened亦不放行)', async function() {
            await mount([
                { id: 'dr', kind: 'WDrawer', state: 'opening' },
                { id: 'a', kind: 'WDialog', state: 'opened' },
            ])
            let t = startWait({ timeout: 700 })
            await t.p
            assert.strict.ok(t.err === null)
            assert.strict.ok(t.ms >= 650 && t.ms < 5000, `應在逾時700ms附近回, 實際${t.ms}ms`)
        })

        it('WDrawer state為值域外之值(元件未來新增之狀態): 不計入, 視為無WDrawer', async function() {
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'weird' }])
            let t = startWait({ timeout: TIMEOUT })
            await t.p
            assert.strict.ok(t.ms < IMMEDIATE, `實際等了${t.ms}ms`)
        })
    })

    describe('opt.selector(取代預設選擇器)', function() {

        it('傳[state]: 還原2.5.35前之行為, 浮層opening亦被等待(等到逾時)', async function() {
            await mount([{ id: 'b', kind: 'WPopperFix', state: 'opening' }])
            let t = startWait({ timeout: 700, selector: '[state]' })
            await t.p
            assert.strict.ok(t.err === null)
            assert.strict.ok(t.ms >= 650 && t.ms < 5000, `應在逾時700ms附近回, 實際${t.ms}ms`)
        })

        it('傳自訂選擇器(#myDrawer): 只認該元素, 即使它不帶WDrawer之辨識屬性', async function() {
            await page.setContent('<div id="myDrawer" state="opening"></div><div state="opening" class="WPopperFix"></div>')
            let t = startWait({ timeout: 8000, selector: '#myDrawer' })
            await observe()
            assert.strict.ok(!t.done)
            await page.evaluate(() => document.getElementById('myDrawer').setAttribute('state', 'opened'))
            await t.p
            assert.strict.ok(t.ms < 4000, `實際共${t.ms}ms`)
        })

        it('自訂選擇器命中元素之state在值域外(如WDialog resizing): 不計入, 立即放行', async function() {
            await mount([{ id: 'a', kind: 'WDialog', state: 'resizing' }])
            let t = startWait({ timeout: TIMEOUT, selector: '[state]' })
            await t.p
            assert.strict.ok(t.ms < IMMEDIATE, `實際等了${t.ms}ms`)
        })

        //非預期之selector(K3: 視為未給, 改用預設, 不拋錯): 非字串、空白字串、無法解析之選擇器
        //  注意缺右括號之'[state'依CSS規格於結尾自動補全而合法, 不可當非法選擇器; '##bad'、'[[x'、'div >'才會使querySelectorAll拋SyntaxError
        let BAD_SELECTORS = ['', '  ', 123, true, false, {}, [], () => {}, '##bad', '[[x', 'div >']

        //expectDefaultSelector, 以opt驗證實際採用預設選擇器(只認WDrawer): ①WDrawer opened且WDialog opening → 立即放行(若誤用'[state]'會等到逾時)
        //  ②WDrawer opening且WDialog opened → 仍等待, 翻轉為opened後放行(若誤判為無抽屜會立即放行)
        let expectDefaultSelector = async (opt, label) => {
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'opened' }, { id: 'a', kind: 'WDialog', state: 'opening' }])
            let t1 = startWait({ timeout: TIMEOUT, ...opt })
            await t1.p
            assert.strict.ok(t1.err === null, `${label}: 不應拋錯`)
            assert.strict.ok(t1.ms < IMMEDIATE, `${label}: 應用預設選擇器而立即放行, 實際等了${t1.ms}ms`)
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'opening' }, { id: 'a', kind: 'WDialog', state: 'opened' }])
            let t2 = startWait({ timeout: 8000, ...opt })
            await observe()
            assert.strict.ok(t2.err === null && !t2.done, `${label}: WDrawer仍在opening, 用預設選擇器時應仍在等待`)
            await setState('dr', 'opened')
            await t2.p
            assert.strict.ok(t2.ms < 4000, `${label}: WDrawer落定後應放行, 實際共${t2.ms}ms`)
        }

        it('selector為非預期之輸入(非字串、空白字串、無法解析): 視為未給, 改用預設選擇器, 不拋錯', async function() {
            for (let bad of BAD_SELECTORS) {
                await expectDefaultSelector({ selector: bad }, `selector=${typeof bad === 'string' ? JSON.stringify(bad) : Object.prototype.toString.call(bad)}`)
            }
        })

        it('selector為undefined或null(未給): 用預設, 行為同前', async function() {
            for (let v of [undefined, null]) {
                await expectDefaultSelector({ selector: v }, `selector=${v}`)
            }
        })

        it('selector無法解析且頁面無WDrawer: 用預設選擇器而立即放行(不因選擇器壞掉而等待或拋錯)', async function() {
            await mount([{ id: 'a', kind: 'WDialog', state: 'opening' }])
            let t = startWait({ timeout: TIMEOUT, selector: '##bad' })
            await t.p
            assert.strict.ok(t.err === null)
            assert.strict.ok(t.ms < IMMEDIATE, `實際等了${t.ms}ms`)
        })

        it('selector合法但前後帶空白(如" #myDrawer "): 照用, 不視為非預期', async function() {
            await page.setContent('<div id="myDrawer" state="opening"></div>')
            let t = startWait({ timeout: 8000, selector: ' #myDrawer ' })
            await observe()
            assert.strict.ok(!t.done)
            await page.evaluate(() => document.getElementById('myDrawer').setAttribute('state', 'opened'))
            await t.p
            assert.strict.ok(t.ms < 4000, `實際共${t.ms}ms`)
        })
    })

    describe('opt.timeout(非預期之輸入改用預設10000ms)', function() {

        //[opt.timeout 種類] 大於0且不超過2147483647之有效數字(數字或數字字串, 轉換後使用); 0在Playwright代表不逾時, 故不收
        let BAD_TIMEOUTS = [0, -1, NaN, Infinity, -Infinity, '', '  ', 'abc', '5s', '0x10', '1e400', '-5', '0', true, false, {}, [], () => {}, 2147483648, '2147483648']

        it('timeout為非預期之輸入: 視為未給, 用預設10000ms(不立即放行、不拋錯)', async function() {
            for (let bad of BAD_TIMEOUTS) {
                await mount([{ id: 'dr', kind: 'WDrawer', state: 'opening' }])
                let label = `timeout=${typeof bad === 'string' ? JSON.stringify(bad) : (typeof bad === 'number' ? String(bad) : Object.prototype.toString.call(bad))}`
                let t = startWait({ timeout: bad })
                await page.waitForTimeout(1200) //否定斷言之觀察窗: 長於任何誤採之小逾時
                assert.strict.ok(t.err === null && !t.done, `${label}: 非預期之timeout應改用預設而仍在等待(WDrawer在opening)`)
                await setState('dr', 'opened')
                await t.p
                assert.strict.ok(t.ms < 8000, `${label}: 落定後應即放行, 實際共${t.ms}ms`)
            }
        })

        it('timeout為0(Playwright代表永不逾時): 改用預設10000ms, WDrawer一直停在opening時約10秒後不拋錯地回', async function() {
            this.timeout(40000)
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'opening' }])
            let t = startWait({ timeout: 0 })
            await t.p
            assert.strict.ok(t.err === null)
            assert.strict.ok(t.ms >= 9500 && t.ms < 20000, `應在預設逾時10000ms附近回, 實際${t.ms}ms`)
        })

        it('timeout為有效數字(數字、數字字串、含空白、科學記號): 轉換後使用(約700ms回)', async function() {
            for (let ok of [700, '700', ' 700 ', '7e2', 700.5]) {
                await mount([{ id: 'dr', kind: 'WDrawer', state: 'opening' }])
                let t = startWait({ timeout: ok })
                await t.p
                assert.strict.ok(t.err === null)
                assert.strict.ok(t.ms >= 650 && t.ms < 5000, `timeout=${JSON.stringify(ok)}: 應在700ms附近回, 實際${t.ms}ms`)
            }
        })

        it('timeout為undefined或null(未給): 用預設; 穩定態時立即放行', async function() {
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'opened' }])
            for (let v of [undefined, null]) {
                let t = startWait({ timeout: v })
                await t.p
                assert.strict.ok(t.ms < IMMEDIATE, `實際等了${t.ms}ms`)
            }
        })
    })

    describe('opt.debug(K3: 非預期之輸入改用預設時才警告)', function() {

        //capture, 以console.warn攔截(Node端)呼叫waitDrawerReady, 回傳警告清單; 頁面為穩定態, 立即放行
        let capture = async (opt) => {
            let warns = []
            let orig = console.warn
            console.warn = (...a) => {
                warns.push(a.join(' '))
            }
            try {
                await mount([{ id: 'dr', kind: 'WDrawer', state: 'opened' }])
                await waitDrawerReady(page, opt)
            }
            finally {
                console.warn = orig
            }
            return warns
        }

        let P = '[w-package-tools-e2e waitDrawerReady] '
        let M_SEL = `${P}invalid opt.selector: must be a non-empty string, using default '[state][changedrawerwidth]'`
        let M_SYN = `${P}invalid opt.selector: must be a valid CSS selector, using default '[state][changedrawerwidth]'`
        let M_TMO = `${P}invalid opt.timeout: must be a positive number up to 2147483647, using default 10000`

        beforeEach(function() {
            waitDrawerReady.resetWarned()
        })

        it('debug未給或非true(false、字串"true"、1、{}、null): 不警告, funLog亦不被呼叫', async function() {
            for (let d of [undefined, false, 'true', 1, {}, null]) {
                let logs = []
                let warns = await capture({ debug: d, selector: 123, timeout: 'abc', funLog: (m) => logs.push(m) })
                assert.strict.deepStrictEqual(warns, [], `debug=${String(d)}`)
                assert.strict.deepStrictEqual(logs, [], `debug=${String(d)}`)
                waitDrawerReady.resetWarned()
            }
        })

        it('debug:true: 以console.warn說明哪個鍵因何改用預設(selector非字串、timeout非預期)', async function() {
            let warns = await capture({ debug: true, selector: 123, timeout: 'abc' })
            assert.strict.deepStrictEqual(warns, [M_SEL, M_TMO]) //依opt鍵序: selector先於timeout
        })

        it('debug:true: 無法解析之選擇器另有專屬訊息(valid CSS selector)', async function() {
            let warns = await capture({ debug: true, selector: '##bad' })
            assert.strict.deepStrictEqual(warns, [M_SYN])
        })

        it('debug:true: 空白字串之selector警告為non-empty string', async function() {
            let warns = await capture({ debug: true, selector: '   ' })
            assert.strict.deepStrictEqual(warns, [M_SEL])
        })

        it('debug:true且有funLog(函數): 交funLog(msg, { fn, reason, key }), 不呼叫console.warn', async function() {
            let logs = []
            let warns = await capture({ debug: true, selector: 123, timeout: -1, funLog: (m, info) => logs.push([m, info]) })
            assert.strict.deepStrictEqual(warns, [])
            assert.strict.deepStrictEqual(logs, [
                [M_SEL, { fn: 'waitDrawerReady', reason: 'selector', key: 'selector' }],
                [M_TMO, { fn: 'waitDrawerReady', reason: 'timeout', key: 'timeout' }],
            ])
        })

        it('funLog非函數: 改用console.warn; funLog拋錯: 忽略, 照常放行', async function() {
            let warns = await capture({ debug: true, selector: 123, funLog: 'x' })
            assert.strict.deepStrictEqual(warns, [M_SEL])
            waitDrawerReady.resetWarned()
            let boom = () => {
                throw new Error('boom')
            }
            let warns2 = await capture({ debug: true, selector: 123, funLog: boom })
            assert.strict.deepStrictEqual(warns2, [])
        })

        it('警告不含傳入之值與過長之鍵名(K9)', async function() {
            let longKey = 'SECRET_KEY_' + 'x'.repeat(40)
            let warns = await capture({ debug: true, selector: '##SECRETSEL', timeout: 'SECRETTIMEOUT', [longKey]: 'SECRETVAL' })
            assert.strict.ok(warns.length === 3, `應有3則警告, 實際${warns.length}: ${warns.join(' | ')}`)
            for (let w of warns) {
                assert.strict.ok(!w.includes('SECRET'), `警告不應含傳入之值: ${w}`)
            }
            assert.strict.ok(warns.includes(`${P}invalid opt: unknown option, ignored`))
        })

        it('同一鍵同一原因每個行程只警告一次; 原因不同仍警告; resetWarned後再警告', async function() {
            let w1 = await capture({ debug: true, selector: 123 })
            let w2 = await capture({ debug: true, selector: true }) //同鍵同原因(非字串)
            let w3 = await capture({ debug: true, selector: '##bad' }) //同鍵不同原因(語法)
            let w4 = await capture({ debug: true, timeout: 'abc' }) //不同鍵
            waitDrawerReady.resetWarned()
            let w5 = await capture({ debug: true, selector: 123 })
            assert.strict.deepStrictEqual([w1, w2, w3, w4, w5], [[M_SEL], [], [M_SYN], [M_TMO], [M_SEL]])
        })

        it('未宣告之鍵(如誤拼selecter): debug時提示為未知選項並忽略', async function() {
            let warns = await capture({ debug: true, selecter: '[state]' })
            assert.strict.deepStrictEqual(warns, [`${P}invalid opt.selecter: unknown option, ignored`])
            let warns2 = await capture({ selecter: '[state]' }) //debug未開
            assert.strict.deepStrictEqual(warns2, [])
        })

        it('合法之opt(含debug:true)不警告: 邊界值2147483647、"2147483647"、0.001與合法selector', async function() {
            let warns = await capture({ debug: true, timeout: 2147483647, selector: '#dr' })
            warns.push(...await capture({ debug: true, timeout: '2147483647', selector: '[state]' }))
            warns.push(...await capture({ debug: true, timeout: 0.001 }))
            warns.push(...await capture({ debug: true, timeout: undefined, selector: null }))
            assert.strict.deepStrictEqual(warns, [])
        })

        it('timeout上限: 2147483648於debug:true時警告', async function() {
            let warns = await capture({ debug: true, timeout: 2147483648 })
            assert.strict.deepStrictEqual(warns, [M_TMO])
        })

        it('鍵之存取器拋錯: 視為該鍵無效而改用預設, 不拋錯; debug時說明無法讀取', async function() {
            let opt = { debug: true }
            let boom = () => {
                throw new Error('getter boom')
            }
            Object.defineProperty(opt, 'timeout', { enumerable: true, get: boom })
            Object.defineProperty(opt, 'selector', { enumerable: true, get: boom })
            let warns = await capture(opt)
            assert.strict.deepStrictEqual(warns, [
                `${P}invalid opt.timeout: cannot be read, using default 10000`,
                `${P}invalid opt.selector: cannot be read, using default '[state][changedrawerwidth]'`,
            ])
        })
    })

    describe('opt本身(K3、V4: undefined、null、非一般物件視為{})', function() {

        //opt為非一般物件時整份視為{}: 頁面僅有WDialog opening(無WDrawer), 用預設選擇器應立即放行; 若誤認其屬性selector:'[state]'、timeout:4000則會等到4000ms
        let faked = (base) => Object.assign(base, { selector: '[state]', timeout: 4000 })
        class Opts {
            constructor() {
                this.selector = '[state]'
                this.timeout = 4000
            }
        }

        it('opt為null、陣列、數字、字串、布林、Date、類別實例、函數: 不拋錯, 整份視為{}(其屬性不被採用)', async function() {
            let cases = [
                ['null', null],
                ['undefined', undefined],
                ['陣列', faked([])],
                ['數字', 5],
                ['字串', 'abc'],
                ['true', true],
                ['Date', faked(new Date())],
                ['類別實例', new Opts()],
                ['函數', faked(() => {})],
            ]
            for (let [label, o] of cases) {
                await mount([{ id: 'a', kind: 'WDialog', state: 'opening' }])
                let t = { done: false, err: null, t0: Date.now(), ms: null }
                t.p = waitDrawerReady(page, o).catch((e) => {
                    t.err = e
                }).then(() => {
                    t.done = true
                    t.ms = Date.now() - t.t0
                })
                await t.p
                assert.strict.ok(t.err === null, `opt=${label}: 不應拋錯: ${t.err}`)
                assert.strict.ok(t.ms < IMMEDIATE, `opt=${label}: 整份視為{}, 用預設選擇器應立即放行, 實際等了${t.ms}ms`)
            }
        })

        it('opt各鍵皆為null: 視為未給, 全用預設', async function() {
            await mount([{ id: 'dr', kind: 'WDrawer', state: 'opened' }, { id: 'a', kind: 'WDialog', state: 'opening' }])
            let t = startWait({ timeout: null, selector: null, debug: null, funLog: null })
            await t.p
            assert.strict.ok(t.err === null && t.ms < IMMEDIATE, `實際等了${t.ms}ms`)
        })

        it('原型為null之一般物件與凍結物件: 照常採用其鍵, 且不改寫呼叫端之opt', async function() {
            await page.setContent('<div id="myDrawer" state="opening"></div>')
            let o = Object.assign(Object.create(null), { selector: '#myDrawer', timeout: '8000' })
            Object.freeze(o)
            let t = startWait(o)
            await observe()
            assert.strict.ok(!t.done, '以selector認#myDrawer(opening), 應仍在等待')
            await page.evaluate(() => document.getElementById('myDrawer').setAttribute('state', 'opened'))
            await t.p
            assert.strict.ok(t.err === null && t.ms < 4000, `實際共${t.ms}ms`)
            assert.strict.deepStrictEqual(Object.keys(o), ['selector', 'timeout'])
            assert.strict.deepStrictEqual([o.selector, o.timeout], ['#myDrawer', '8000'])
        })
    })
})
