import assert from 'assert'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import wpw from 'w-playwright'
import launchBrowser from '../src/launchBrowser.mjs'
import chromiumLaunchArgs from '../src/chromiumLaunchArgs.mjs'
import withHostLang from './tools/withHostLang.mjs'


//launchBrowser 經 w-playwright 之接線測試(本套件帳本 sgud/rule/rulebook_launch.md R-LB-1～R-LB-5; w-playwright 帳本 R-PW-WIRING)
//[LB01]～[LB03]、[LB05]、[LB06]: 以 spy(包住 wpw.launchChromium, 取合併前之原始選項)或替身(wpw.setBrowserTypeForTest, 取合併後之選項)驗證, 不啟動瀏覽器
//[LB04]: 替身以 next() 走真路徑, 真啟動 headless shell
//[LB07]、[LB07c]: 子行程內不掛替身之真路徑, 真啟動 headless shell, 讀 Playwright 之 <launching> 紀錄驗實際命令列(含語系開關恰一個)
//[LB09]～[LB12]: 語系旗標(--lang=zh-TW)與呼叫端自給語系(opt.args、opt.lang)之合併, 以替身取 w-playwright 合併後之 args(R-LB-6)
//[LB13]: installTimeout(autoInstall 之整體安裝上限; 排程第 636 項 ⑤)與 w-playwright 自用鍵之原樣傳遞(spy 不啟動; 替身層驗自用鍵不轉傳)
//本檔只啟動 headless shell(無頭、未給通道), 不啟動真 Chrome、Edge、完整 Chromium


//fpCmdline, [LB07] 之子行程腳本(模組自身位置)
let fpCmdline = fileURLToPath(new URL('./tools/launchBrowserCmdline.mjs', import.meta.url))


//GUARD, w-playwright 一律加入之守門功能(停用即不再以錯誤密碼呼叫 LogonUser)
let GUARD = 'AutofillAiWalletPrivatePasses'


//switchName, 開關名: 去前置連字號、轉小寫、取等號之前(同 w-playwright 之判定)
function switchName(a) {
    let s = String(a).replace(/^-+/, '').toLowerCase()
    let i = s.indexOf('=')
    return i >= 0 ? s.slice(0, i) : s
}


//disableArgs, 參數陣列中之 --disable-features 開關(不分大小寫與連字號數)
function disableArgs(args) {
    return args.filter((a) => switchName(a) === 'disable-features')
}


//featuresOf, 開關值之功能清單
function featuresOf(arg) {
    let i = arg.indexOf('=')
    if (i < 0) {
        return []
    }
    return arg.slice(i + 1).split(',').map((s) => s.trim()).filter((s) => s !== '')
}


//SIX, 確定性渲染六旗標之契約值(獨立於 src/chromiumLaunchArgs.mjs; 旗標有意變更時依標準圖流程一併改此處)
let SIX = [
    '--disable-gpu',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--disable-font-subpixel-positioning',
    '--disable-skia-runtime-opts',
    '--disable-partial-raster',
]


//LANG_SW, 語系旗標之契約值(固定應用程式語系為 zh-TW; 排程第 585 項; 獨立於 src/chromiumLaunchArgs.mjs)
let LANG_SW = '--lang=zh-TW'


//SEVEN, 六旗標＋語系旗標(第 585 項時之旗標組全體; 排程第 636 項 ⑦ 於其後附加 SMOOTH, 故為旗標組之前七項)
let SEVEN = [...SIX, LANG_SW]


//SMOOTH, 關閉平滑捲動之旗標(排程第 636 項 ⑦: 鍵盤與滾輪之捲動即時到位, 測試不因動畫相位而時序競賽; 附於旗標組之末, 獨立於 src/chromiumLaunchArgs.mjs)
let SMOOTH = '--disable-smooth-scrolling'


//FULL, 旗標組全體(八項: 六旗標、語系旗標、SMOOTH); launchBrowser 於呼叫端未自給語系時送出之 args 前綴
let FULL = [...SEVEN, SMOOTH]


//BASE, 旗標組去掉語系旗標之七項(六旗標、SMOOTH); launchBrowser 於呼叫端自給語系時送出之 args 前綴
let BASE = [...SIX, SMOOTH]


//isLangArg, 是否為語系開關(去前置連字號、轉小寫、取等號之前為 lang; 同 w-playwright 之辨識, 獨立實作供斷言用)
function isLangArg(a) {
    return switchName(a) === 'lang'
}


//pending, 尚未還原之替身與 spy(mocha 逾時不會取消進行中之 Promise, 以 afterEach 兜底還原, 不影響同一 mocha 行程之其他測試檔)
let pending = new Set()


//withFake, 以替身取代 w-playwright 呼叫之 BrowserType, 記錄每次收到之合併後選項; finally 還原
async function withFake(launchImpl, fn) {
    let calls = []
    let restore = wpw.setBrowserTypeForTest({
        launch: async (o, next) => {
            calls.push(o)
            return launchImpl(o, next)
        },
    })
    pending.add(restore)
    try {
        return await fn(calls)
    }
    finally {
        pending.delete(restore)
        restore()
    }
}


//withSpy, 暫時包住 wpw.launchChromium, 記錄 launchBrowser 傳入之原始選項(合併前); forward 為 true 時轉呼叫原函數, 否則回 stub(不經 w-playwright, 不讀錯誤次數、不啟動); finally 還原
async function withSpy(fn, forward = true) {
    let orig = wpw.launchChromium
    let raw = []
    wpw.launchChromium = (o) => {
        raw.push(o)
        return forward ? orig(o) : Promise.resolve(stub)
    }
    let restore = () => {
        wpw.launchChromium = orig
    }
    pending.add(restore)
    try {
        return await fn(raw)
    }
    finally {
        pending.delete(restore)
        restore()
    }
}


//killTree, 結束子行程樹(Windows 以 taskkill /T, 隱藏視窗)
function killTree(cp) {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(cp.pid)], { windowsHide: true, stdio: 'ignore' })
    }
    else {
        try {
            cp.kill('SIGKILL')
        }
        catch (err) {}
    }
}


//parseLaunching, 解析 Playwright 之 <launching> 紀錄(執行檔路徑與參數以空白直接串接): 執行檔取至 chrome-headless-shell(.exe) 為止(路徑可含空白), 其後以空白切為參數
function parseLaunching(line) {
    let m = /^(.*?chrome-headless-shell(?:\.exe)?)(?:\s+(.*))?$/i.exec(line)
    if (!m) {
        return { exe: '', args: [] }
    }
    return { exe: m[1], args: String(m[2] || '').split(' ').filter((s) => s !== '') }
}


//stub, 替身回傳之假 Browser(不啟動)
let stub = { stub: true }


describe('launchBrowser 經 w-playwright(接線)', function() {
    this.timeout(120000)

    let info = wpw.getPlaywrightInfo()
    let pwDefaultDisable = '--disable-features=' + info.defaultDisableFeatures.join(',')

    afterEach(function() {
        for (let restore of pending) {
            restore()
        }
        pending.clear()
    })

    it('[LB00] 旗標組之內容為確定性渲染之契約值: 六旗標原序在前、語系旗標--lang=zh-TW第七、--disable-smooth-scrolling在末、凍結(不以受測陣列自比)', function() {
        //R-LB-6、R-LB-7: 旗標組為八項(六旗標＋語系旗標＋關閉平滑捲動), 前七項與順序不變, 語系旗標恰一個、關閉平滑捲動恰一個且為最後一項
        assert.strict.deepEqual([...chromiumLaunchArgs], FULL)
        assert.strict.deepEqual([...chromiumLaunchArgs].slice(0, 6), SIX)
        assert.strict.deepEqual([...chromiumLaunchArgs].slice(0, 7), SEVEN)
        assert.strict.equal(chromiumLaunchArgs.length, 8)
        assert.strict.equal(chromiumLaunchArgs[chromiumLaunchArgs.length - 1], SMOOTH)
        assert.strict.deepEqual(chromiumLaunchArgs.filter((a) => switchName(a) === 'disable-smooth-scrolling'), [SMOOTH])
        assert.strict.equal(Object.isFrozen(chromiumLaunchArgs), true)
        assert.strict.deepEqual(chromiumLaunchArgs.filter(isLangArg), [LANG_SW])
    })

    it('[LB01] 未給opt: 呼叫wpw.launchChromium恰1次(headless、autoInstall、installDeps為true, args為八旗標); 替身恰1次, 合併後args為八旗標＋唯一之--disable-features(含Playwright預設與守門功能), ignoreDefaultArgs去掉Playwright預設串', async function() {
        await withSpy(async (raw) => {
            await withFake(async () => stub, async (calls) => {
                let r = await launchBrowser()

                //R-LB-1: launchBrowser 之唯一啟動為 wpw.launchChromium, 選項為 { headless:true, autoInstall:true, installDeps:true, ...opt, args:[...八旗標, ...opt.args] }
                assert.strict.deepEqual(raw, [{ headless: true, autoInstall: true, installDeps: true, args: [...FULL] }])

                //R-LB-2: 經 w-playwright 之 BrowserType(替身被呼叫, 依賴樹僅一份 w-playwright)
                assert.strict.equal(calls.length, 1)
                assert.strict.equal(r, stub)
                let o = calls[0]
                assert.strict.equal(o.headless, true)

                //R-LB-2、R-LB-6、R-LB-7: 八旗標原序在前(語系旗標已在, w-playwright 不另補第二個 --lang), 合併之 --disable-features 為最後一個元素且唯一
                assert.strict.deepEqual(o.args.slice(0, 8), [...FULL])
                assert.strict.deepEqual(o.args.filter(isLangArg), [LANG_SW])
                assert.strict.equal(o.args.length, 9)
                let dis = disableArgs(o.args)
                assert.strict.equal(dis.length, 1)
                assert.strict.equal(o.args[o.args.length - 1], dis[0])
                let feats = featuresOf(dis[0])
                assert.strict.ok(feats.includes(GUARD))
                assert.strict.deepEqual(info.defaultDisableFeatures.filter((f) => !feats.includes(f)), [])
                assert.strict.deepEqual(feats.filter((f) => f !== GUARD && !info.defaultDisableFeatures.includes(f)), [])

                //R-LB-2: Playwright 預設之 --disable-features 串被 ignoreDefaultArgs 去掉(命令列只剩合併之一串)
                assert.strict.ok(o.ignoreDefaultArgs.includes(pwDefaultDisable))
            })
        })
    })

    it('[LB02] opt.args附加於旗標組之後(自給語系者旗標組去語系)、呼叫端之--disable-features吸收進同一串; 其餘鍵原樣; opt.autoInstall可覆寫', async function() {
        await withSpy(async (raw) => {
            await withFake(async () => stub, async (calls) => {
                await launchBrowser({ args: ['--lang=en-US', '--disable-features=Translate,SomeCallerFeature'], timeout: 12345, autoInstall: false })

                //R-LB-1: ...opt 在預設之後(呼叫端可覆寫 autoInstall), args 為七旗標(六旗標＋關閉平滑捲動; 呼叫端自給語系故不帶旗標組之語系)＋opt.args
                assert.strict.deepEqual(raw, [{ headless: true, autoInstall: false, installDeps: true, timeout: 12345, args: [...BASE, '--lang=en-US', '--disable-features=Translate,SomeCallerFeature'] }])

                //R-LB-2: 呼叫端之功能開關被吸收, 命令列仍只有一串
                assert.strict.equal(calls.length, 1)
                let o = calls[0]
                assert.strict.equal(o.timeout, 12345)
                assert.strict.deepEqual(o.args.slice(0, 8), [...BASE, '--lang=en-US'])
                let dis = disableArgs(o.args)
                assert.strict.equal(dis.length, 1)
                assert.strict.equal(o.args[o.args.length - 1], dis[0])
                let feats = featuresOf(dis[0])
                assert.strict.ok(feats.includes(GUARD))
                assert.strict.ok(feats.includes('Translate'))
                assert.strict.ok(feats.includes('SomeCallerFeature'))
            })
        })
    })

    it('[LB02b] opt.args非陣列時忽略, 只帶八旗標(行為不變; 非陣列之--lang字串不算呼叫端自給語系, 仍用--lang=zh-TW)', async function() {
        await withSpy(async (raw) => {
            await withFake(async () => stub, async (calls) => {
                await launchBrowser({ args: '--lang=en-US' })
                assert.strict.deepEqual(raw[0].args, [...FULL])
                assert.strict.equal(calls.length, 1)
                assert.strict.deepEqual(calls[0].args.slice(0, 8), [...FULL])
                assert.strict.deepEqual(calls[0].args.filter(isLangArg), [LANG_SW])
                assert.strict.equal(disableArgs(calls[0].args).length, 1)
            })
        })
    })

    it('[LB02c] 呼叫端之--enable-features另合併為唯一一串: 一般啟用項保留, 守門功能與被呼叫端停用之項剔除; --disable-features仍唯一且為最後一個元素', async function() {
        await withFake(async () => stub, async (calls) => {
            await launchBrowser({ args: [`--enable-features=SomeEnabled,${GUARD},BothListed`, '--disable-features=BothListed'] })
            assert.strict.equal(calls.length, 1)
            let o = calls[0]
            //R-LB-2: 啟用串唯一、含一般啟用項, 不含守門功能(守門不可被呼叫端啟用)與被呼叫端停用之項(衝突收嚴)
            let en = o.args.filter((a) => switchName(a) === 'enable-features')
            assert.strict.equal(en.length, 1)
            let enFeats = featuresOf(en[0])
            assert.strict.ok(enFeats.includes('SomeEnabled'))
            assert.strict.ok(!enFeats.includes(GUARD))
            assert.strict.ok(!enFeats.includes('BothListed'))
            //R-LB-2: 停用串唯一、為最後一個元素、含守門與呼叫端停用項
            let dis = disableArgs(o.args)
            assert.strict.equal(dis.length, 1)
            assert.strict.equal(o.args[o.args.length - 1], dis[0])
            let disFeats = featuresOf(dis[0])
            assert.strict.ok(disFeats.includes(GUARD))
            assert.strict.ok(disFeats.includes('BothListed'))
        })
    })

    it('[LB02d] opt之有效鍵原樣送出(headless、channel、executablePath、autoInstall、installDeps以布林值覆寫、timeout)', async function() {
        //spy 不轉呼叫 w-playwright(不讀錯誤次數、不啟動); 只驗 launchBrowser 送出之原始選項
        await withSpy(async (raw) => {
            let r = await launchBrowser({ headless: false, channel: 'chrome', executablePath: 'C:\\x\\chrome.exe', autoInstall: false, installDeps: false, timeout: 5000, args: ['--lang=en-US'] })
            assert.strict.equal(r, stub)
            //R-LB-1: ...opt 在預設之後, 有效值原樣送出
            assert.strict.deepEqual(raw, [{ headless: false, channel: 'chrome', executablePath: 'C:\\x\\chrome.exe', autoInstall: false, installDeps: false, timeout: 5000, args: [...BASE, '--lang=en-US'] }])
        }, false)
    })

    it('[LB08] opt.autoInstall、opt.installDeps非布林值(undefined、null、字串、數字)時改用本函數之預設true(K3), 不交由w-playwright之預設false', async function() {
        for (let v of [undefined, null, 'true', 1]) {
            await withSpy(async (raw) => {
                await launchBrowser({ autoInstall: v, installDeps: v })
                //R-LB-1: 非預期值視為未給, 用 launchBrowser 之預設 true
                assert.strict.equal(raw.length, 1)
                assert.strict.equal(raw[0].autoInstall, true, `autoInstall for ${String(v)}`)
                assert.strict.equal(raw[0].installDeps, true, `installDeps for ${String(v)}`)
            }, false)
        }
    })

    it('[LB13] opt.installTimeout(autoInstall之整體安裝上限)與w-playwright之自用鍵(debug、funLog、onTrace)原樣送給wpw.launchChromium(含0、數字字串、無效值; 不解讀、不補預設、不改寫); 未給時不帶該鍵(預設INSTALL_BUDGET_MS由w-playwright採用); 經w-playwright後不轉傳給BrowserType(為自用鍵)', async function() {
        //需求(排程第 636 項 ⑤): installTimeout 之傳遞——本函數之 ...opt 本即原樣交出, 以測試釘住, 防日後加入白名單或預設而丟鍵
        let values = [900000, 12345, 0, '5000', -1, 'abc', null, undefined, NaN, Infinity]
        for (let v of values) {
            await withSpy(async (raw) => {
                await launchBrowser({ installTimeout: v })
                assert.strict.equal(raw.length, 1)
                if (v === undefined || v === null) {
                    //w-playwright 視 undefined、null 為未給(K3): 鍵不帶或原值皆等價, 不釘「鍵存在」
                    assert.strict.ok(!Object.hasOwn(raw[0], 'installTimeout') || Object.is(raw[0].installTimeout, v), `installTimeout 不得被補為他值: ${String(v)}`)
                }
                else {
                    assert.strict.ok(Object.hasOwn(raw[0], 'installTimeout'), `installTimeout 鍵須原樣送出: ${String(v)}`)
                    assert.strict.ok(Object.is(raw[0].installTimeout, v), `installTimeout 值須原樣送出: ${String(v)}`)
                }
            }, false)
        }

        //未給: 不帶該鍵(不由本函數補預設; 預設為 w-playwright 之 INSTALL_BUDGET_MS)
        await withSpy(async (raw) => {
            await launchBrowser({ autoInstall: true })
            assert.strict.equal(raw.length, 1)
            assert.strict.equal(Object.hasOwn(raw[0], 'installTimeout'), false)
        }, false)

        //與 w-playwright 其他自用鍵並用: 原樣(同一物件參照)送出
        let funLog = () => {}
        let onTrace = () => {}
        await withSpy(async (raw) => {
            await launchBrowser({ installTimeout: 4321, debug: true, funLog, onTrace })
            assert.strict.equal(raw[0].installTimeout, 4321)
            assert.strict.equal(raw[0].debug, true)
            assert.strict.equal(raw[0].funLog, funLog)
            assert.strict.equal(raw[0].onTrace, onTrace)
        }, false)

        //經 w-playwright(替身層取合併後之選項): 自用鍵不轉傳給 BrowserType(installTimeout 被 w-playwright 辨識為自用鍵而非原樣交 Playwright)
        await withFake(async () => stub, async (calls) => {
            //自用鍵須真的給了, 否則「不轉傳」之斷言為空斷言
            await launchBrowser({ installTimeout: 5000, headless: true, debug: false, funLog, onTrace })
            assert.strict.equal(calls.length, 1)
            for (let k of ['installTimeout', 'autoInstall', 'installDeps', 'debug', 'funLog', 'onTrace']) {
                assert.strict.equal(Object.hasOwn(calls[0], k), false, `自用鍵不得轉傳給 BrowserType: ${k}`)
            }
        })
    })

    it('[LB03] opt.args含無效元素(不以-開頭)時w-playwright判整個args無效: 旗標組(含--lang=zh-TW)一併捨棄, 只留守門之一串與w-playwright依主機系統語系補入之--lang(行為變更, README §5)', async function() {
        await withFake(async () => stub, async (calls) => {
            //主機系統語系模擬為 de-DE, 使補入之語系可與旗標組之 zh-TW 區分
            await withHostLang('de-DE', () => launchBrowser({ args: ['not-a-switch'] }))
            assert.strict.equal(calls.length, 1)
            let o = calls[0]
            //R-LB-4(行為變更): 原為 Playwright 拋錯; 現為整個 args 視為 [](守門照加); 七旗標皆不在
            assert.strict.deepEqual(BASE.filter((a) => o.args.includes(a)), [], '六旗標與關閉平滑捲動皆隨整個 args 捨棄')
            //R-LB-6: --lang=zh-TW 隨整個 args 捨棄(此時失去確定性語系, README §5); w-playwright 之預設語系(R-PW-LANG: 呼叫端 args 無語系開關時補主機系統語系)補入主機語系
            assert.strict.equal(o.args.includes(LANG_SW), false)
            assert.strict.deepEqual(o.args.filter(isLangArg), ['--lang=de-DE'])
            assert.strict.equal(o.args.length, 2)
            assert.strict.ok(featuresOf(disableArgs(o.args)[0]).includes(GUARD))
        })
    })

    it('[LB04] 替身以next()走真路徑: 以同一份合併後選項真啟動headless shell, 頁面可用', async function() {
        let browser = null
        try {
            await withFake(async (o, next) => next(), async (calls) => {
                browser = await launchBrowser()
                //R-LB-3: 替身被呼叫, 其 next() 以合併後選項真啟動
                assert.strict.equal(calls.length, 1)
                assert.strict.equal(disableArgs(calls[0].args).length, 1)
            })

            //R-LB-3: 真啟動之瀏覽器可用
            let page = await browser.newPage()
            await page.setContent('<div id="x">ok</div>')
            assert.strict.equal(await page.textContent('#x'), 'ok')
        }
        finally {
            if (browser) {
                await browser.close()
            }
        }
    })

    //runCmdline, 以子行程(test/tools/launchBrowserCmdline.mjs)不掛替身經 launchBrowser 真啟動 headless shell, 回其 RESULT 物件(含 Playwright 之 <launching> 紀錄與頁面之 navigator.language)
    //hostLang 為模擬之主機系統語系(子行程以 withHostLang 替身使 w-playwright 取得該語系; 使結果不隨執行機器之實際系統語系而變)
    async function runCmdline(opt, hostLang) {
        //子行程之環境: DEBUG=pw:browser(Playwright 於載入時讀取, 寫 <launching> 紀錄); 去掉會被 w-playwright 拒絕之 PWDEBUG、SELENIUM_*
        let env = { ...process.env, DEBUG: 'pw:browser' }
        for (let k of ['PWDEBUG', 'SELENIUM_REMOTE_URL', 'SELENIUM_REMOTE_CAPABILITIES', 'SELENIUM_REMOTE_HEADERS']) {
            delete env[k]
        }
        let argv = [fpCmdline, opt === undefined ? '' : JSON.stringify(opt)]
        if (hostLang) {
            argv.push(hostLang)
        }
        let out = await new Promise((resolve, reject) => {
            let cp = spawn(process.execPath, argv, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
            let so = ''
            cp.stdout.on('data', (d) => {
                so += String(d)
            })
            cp.stderr.on('data', () => {})
            //防懸置上限(真實計時器): 逾時以樹狀結束子行程(含其起之瀏覽器與安裝子行程)
            let t = setTimeout(() => {
                killTree(cp)
                reject(new Error('launchBrowserCmdline timed out'))
            }, 100000)
            cp.on('error', (err) => {
                clearTimeout(t)
                reject(err)
            })
            cp.on('close', () => {
                clearTimeout(t)
                resolve(so)
            })
        })
        let line = out.split(/\r?\n/).filter((s) => s.startsWith('RESULT ')).pop()
        assert.strict.ok(line, 'child printed no RESULT line')
        let r = JSON.parse(line.slice(7))
        assert.strict.equal(r.ok, true, `child failed: ${r.code} ${r.message}`)
        assert.strict.equal(r.text, 'ok')

        //R-LB-3: 恰一次啟動, 執行檔為 headless shell(本檔不啟動真 Chrome、Edge、完整 Chromium)
        assert.strict.equal(r.launching.length, 1)
        let { exe, args: toks } = parseLaunching(r.launching[0])
        assert.strict.ok(exe !== '', `unexpected executable: ${r.launching[0].slice(0, 200)}`)
        return { r, toks }
    }

    it('[LB07] 不掛替身之真路徑(子行程; 模擬主機系統語系為en-US): 實際執行檔為headless shell; 實際命令列恰一個--disable-features, 其功能集合＝Playwright預設∪守門; 八旗標皆在命令列, 語系開關恰一個且為--lang=zh-TW(不隨主機語系)', async function() {
        let { r, toks } = await runCmdline(undefined, 'en-US')

        //R-LB-3、R-LB-7: 實際命令列恰一個 --disable-features, 其集合＝Playwright 預設∪守門; 八旗標(含 --disable-smooth-scrolling)皆在
        let dis = disableArgs(toks)
        assert.strict.equal(dis.length, 1)
        let feats = featuresOf(dis[0])
        assert.strict.deepEqual([...new Set(feats)].sort(), [...new Set([...info.defaultDisableFeatures, GUARD])].sort())
        assert.strict.deepEqual(FULL.filter((a) => !toks.includes(a)), [])

        //R-LB-6: 實際命令列之語系開關恰一個、為 --lang=zh-TW(不因 w-playwright 之主機語系預設而多一個或換值), 頁面 navigator.language 為 zh-TW
        assert.strict.deepEqual(toks.filter(isLangArg), [LANG_SW])
        assert.strict.equal(r.lang, 'zh-TW')
    })

    it('[LB07c] 不掛替身之真路徑(子行程; 模擬主機系統語系為ja-JP): 呼叫端經opt.args自給--lang=en-US時, 實際命令列之語系開關恰一個且為--lang=en-US(以呼叫端為準, 不含--lang=zh-TW與主機語系), 其餘六旗標皆在', async function() {
        let { r, toks } = await runCmdline({ args: ['--lang=en-US'] }, 'ja-JP')

        //R-LB-6: 恰一個 --lang, 值為呼叫端所給; 旗標組之 --lang=zh-TW 不在
        assert.strict.deepEqual(toks.filter(isLangArg), ['--lang=en-US'])
        assert.strict.equal(toks.includes(LANG_SW), false)
        assert.strict.deepEqual(BASE.filter((a) => !toks.includes(a)), [])
        assert.strict.equal(disableArgs(toks).length, 1)
        assert.strict.equal(r.lang, 'en-US')
    })

    it('[LB07b] parseLaunching: 執行檔路徑含空白時仍取完整路徑, 其後切為參數; 非headless shell之紀錄回空執行檔', function() {
        let p = parseLaunching('C:\\Users\\A B\\ms-playwright\\chromium_headless_shell-1248\\chrome-headless-shell-win64\\chrome-headless-shell.exe --disable-gpu --disable-features=X,Y --user-data-dir=C:\\T\\p')
        assert.strict.equal(p.exe, 'C:\\Users\\A B\\ms-playwright\\chromium_headless_shell-1248\\chrome-headless-shell-win64\\chrome-headless-shell.exe')
        assert.strict.deepEqual(p.args, ['--disable-gpu', '--disable-features=X,Y', '--user-data-dir=C:\\T\\p'])
        assert.strict.equal(parseLaunching('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --x').exe, '')
    })

    it('[LB05] 啟動失敗時reject w-playwright之固定詞彙錯誤(帶code), 不附原錯誤(行為變更, README §5)', async function() {
        //一般失敗 → E_LAUNCH
        await withFake(async () => {
            throw new Error('boom-original-message')
        }, async (calls) => {
            let err = null
            try {
                await launchBrowser()
            }
            catch (e) {
                err = e
            }
            assert.strict.equal(calls.length, 1)
            assert.strict.ok(err instanceof Error)
            assert.strict.equal(err.code, 'E_LAUNCH')
            assert.strict.ok(!String(err.message).includes('boom-original-message'))
        })

        //受管瀏覽器缺檔(替身層不自動安裝) → E_BROWSER_MISSING
        await withFake(async () => {
            throw new Error('Executable doesn\'t exist at C:\\ms-playwright\\chromium_headless_shell-0000\\chrome-headless-shell.exe')
        }, async (calls) => {
            let err = null
            try {
                await launchBrowser()
            }
            catch (e) {
                err = e
            }
            assert.strict.equal(calls.length, 1)
            assert.strict.equal(err && err.code, 'E_BROWSER_MISSING')
        })
    })

    it('[LB06] 環境變數SELENIUM_REMOTE_URL有值時reject E_ENV且不啟動(替身未被呼叫; 行為變更, README §5)', async function() {
        let k = 'SELENIUM_REMOTE_URL'
        let had = Object.prototype.hasOwnProperty.call(process.env, k)
        let prev = process.env[k]
        process.env[k] = 'http://127.0.0.1:9/'
        try {
            await withFake(async () => stub, async (calls) => {
                let err = null
                try {
                    await launchBrowser()
                }
                catch (e) {
                    err = e
                }
                assert.strict.equal(err && err.code, 'E_ENV')
                assert.strict.equal(calls.length, 0)
            })
        }
        finally {
            if (had) {
                process.env[k] = prev
            }
            else {
                delete process.env[k]
            }
        }
    })

    //以下為語系旗標(--lang=zh-TW; 排程第 585 項)之接線案 [LB09]～[LB12]: 皆用替身(不啟動瀏覽器), 取 w-playwright 合併後之 args; 真瀏覽器之語系與字型見 e2e-launchBrowserLang.test.mjs
    //langArgs, 合併後 args 之語系開關(依 args 內順序)
    function langArgs(o) {
        return o.args.filter(isLangArg)
    }

    //finalArgs, 經 launchBrowser 與 w-playwright 合併後(替身收到)之 args; 主機系統語系模擬為 de-DE(非 zh-TW, 使「預設行為」與「固定 --lang=zh-TW」之結果可分, 不隨執行機器而變)
    async function finalArgs(opt) {
        let out = null
        await withFake(async () => stub, async (calls) => {
            await withHostLang('de-DE', () => launchBrowser(opt))
            assert.strict.equal(calls.length, 1)
            out = calls[0].args
        })
        return out
    }

    it('[LB09] 呼叫端經opt.args自給語系開關(各種寫法)時, 最終args之語系開關恰一個且為呼叫端所給(含--lang=zh-TW本身), 不含旗標組之--lang=zh-TW(重複); 六旗標原序在前、呼叫端args緊隨其後', async function() {
        let spellings = ['--lang=en-US', '-lang=en-US', '--LANG=en-US', '--Lang=ja-JP', '---lang=de-DE', '--lang', '--lang=', '--lang=zh-CN', LANG_SW]
        for (let s of spellings) {
            let args = await finalArgs({ args: [s] })
            //R-LB-6: 語系開關恰一個、為呼叫端所給(以呼叫端為準); 同名開關不因旗標組而重複
            assert.strict.deepEqual(args.filter(isLangArg), [s], `spelling ${s}`)
            //R-LB-6、R-LB-7: 六旗標與關閉平滑捲動原序在前(旗標組去語系), 呼叫端 args 緊隨其後(w-playwright 不移動呼叫端之語系開關)
            assert.strict.deepEqual(args.slice(0, 8), [...BASE, s], `order for ${s}`)
            assert.strict.equal(disableArgs(args).length, 1)
        }

        //呼叫端 args 夾其他旗標時, 順序原樣(六旗標 → 呼叫端 args), 語系開關仍唯一
        let args = await finalArgs({ args: ['--window-size=800,600', '--lang=en-US', '--mute-audio'] })
        assert.strict.deepEqual(args.slice(0, 10), [...BASE, '--window-size=800,600', '--lang=en-US', '--mute-audio'])
        assert.strict.deepEqual(args.filter(isLangArg), ['--lang=en-US'])
    })

    it('[LB09b] 呼叫端給兩個語系開關時原樣保留(w-playwright之規則: 給兩個即兩個, 呼叫端自負), 旗標組之--lang=zh-TW不再加第三個', async function() {
        let args = await finalArgs({ args: ['--lang=en-US', '--lang=fr-FR'] })
        assert.strict.deepEqual(args.filter(isLangArg), ['--lang=en-US', '--lang=fr-FR'])
    })

    it('[LB09c] 非語系開關之相近旗標(--language=、--lang-x=)不算呼叫端自給語系: 旗標組之--lang=zh-TW照帶, 呼叫端旗標原樣保留', async function() {
        for (let s of ['--language=en-US', '--lang-x=1', '--no-lang']) {
            let args = await finalArgs({ args: [s] })
            assert.strict.deepEqual(args.slice(0, 9), [...FULL, s], `near-miss ${s}`)
            assert.strict.deepEqual(args.filter(isLangArg), [LANG_SW], `near-miss ${s}`)
        }
    })

    it('[LB10] 呼叫端給opt.lang: 有效語系字串者最終args之語系開關恰一個且為該值(旗標組之--lang=zh-TW不帶); false則不帶任何--lang; 無效值視為未給仍用--lang=zh-TW; 並與w-playwright對該值之取捨一致(防兩邊語法漂移)', async function() {
        //[值, 是否為有效語系字串]
        let cases = [
            ['en-US', true],
            ['ja-JP', true],
            ['zh-CN', true],
            ['ja', true],
            ['fr', true],
            ['zh-Hant-TW', true],
            ['x', false],
            ['', false],
            ['en_US', false],
            ['en-US,fr', false],
            ['english-US', false],
            ['en-', false],
            ['-en', false],
            ['en US', false],
            ['en-US-abcdefghi', false],
            ['en-aaaaaaaa-bbbbbbbb-cccccccc-ddddd', true], //總長35(上限)
            ['en-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd', false], //總長38(逾35)
            ['a'.repeat(40), false],
        ]
        for (let [v, valid] of cases) {
            //與 w-playwright 之取捨一致: 其對該值補入之語系開關為 '--lang=<值>' 者即有效
            let wpwTakes = wpw.getChromiumLaunchOptions({ args: [], lang: v }).args.includes(`--lang=${v}`)
            assert.strict.equal(wpwTakes, valid, `w-playwright takes ${JSON.stringify(v)}`)

            let args = await finalArgs({ lang: v })
            if (valid) {
                //R-LB-6: 呼叫端之 opt.lang 為準, 旗標組之 --lang=zh-TW 不帶, 命令列恰一個
                assert.strict.deepEqual(langArgs({ args }), [`--lang=${v}`], `opt.lang ${v}`)
                assert.strict.deepEqual(args.slice(0, 7), [...BASE])
            }
            else {
                //R-LB-6: 無效值視為未給, 仍用旗標組之 --lang=zh-TW(不退回主機語系)
                assert.strict.deepEqual(langArgs({ args }), [LANG_SW], `invalid opt.lang ${JSON.stringify(v)}`)
                assert.strict.deepEqual(args.slice(0, 8), [...FULL])
            }
        }

        //非字串之無效值同樣視為未給
        for (let v of [5, null, true, {}, [], undefined]) {
            let args = await finalArgs({ lang: v })
            assert.strict.deepEqual(langArgs({ args }), [LANG_SW], `invalid opt.lang ${String(v)}`)
        }

        //false: 不帶任何 --lang(呼叫端明示不要; 與改版前之 opt.lang:false 行為相同)
        let a = await finalArgs({ lang: false })
        assert.strict.deepEqual(langArgs({ args: a }), [])
        assert.strict.deepEqual(a.slice(0, 7), [...BASE])
        assert.strict.equal(a.length, 8)
    })

    it('[LB11] 優先序: opt.args之語系開關優先於opt.lang(opt.lang被w-playwright忽略), opt.lang為false時opt.args之語系開關仍保留; opt.args非陣列時不算自給語系', async function() {
        let a1 = await finalArgs({ args: ['--lang=fr-FR'], lang: 'ja-JP' })
        assert.strict.deepEqual(langArgs({ args: a1 }), ['--lang=fr-FR'])

        let a2 = await finalArgs({ args: ['--lang=fr-FR'], lang: false })
        assert.strict.deepEqual(langArgs({ args: a2 }), ['--lang=fr-FR'])

        let a3 = await finalArgs({ args: '--lang=fr-FR', lang: 'ja-JP' })
        assert.strict.deepEqual(langArgs({ args: a3 }), ['--lang=ja-JP'])

        let a4 = await finalArgs({ args: '--lang=fr-FR' })
        assert.strict.deepEqual(langArgs({ args: a4 }), [LANG_SW])
    })

    it('[LB12] 送給wpw.launchChromium之原始選項: 呼叫端自給語系時args不含旗標組之--lang(opt.lang原樣保留於選項), 未自給時為八旗標; 不改動呼叫端之args陣列與凍結之旗標組', async function() {
        await withSpy(async (raw) => {
            let mine = ['--lang=en-US']
            await launchBrowser({ args: mine })
            await launchBrowser({ lang: 'ja-JP' })
            await launchBrowser({ lang: false })
            await launchBrowser({ lang: 'bad lang' })
            await launchBrowser({ args: ['--window-size=800,600'] })
            assert.strict.equal(raw.length, 5)

            //R-LB-1、R-LB-6
            assert.strict.deepEqual(raw[0].args, [...BASE, '--lang=en-US'])
            assert.strict.deepEqual(raw[1].args, [...BASE])
            assert.strict.equal(raw[1].lang, 'ja-JP')
            assert.strict.deepEqual(raw[2].args, [...BASE])
            assert.strict.equal(raw[2].lang, false)
            assert.strict.deepEqual(raw[3].args, [...FULL])
            assert.strict.equal(raw[3].lang, 'bad lang')
            assert.strict.deepEqual(raw[4].args, [...FULL, '--window-size=800,600'])

            //呼叫端之陣列與旗標組不被改動
            assert.strict.deepEqual(mine, ['--lang=en-US'])
            assert.strict.deepEqual([...chromiumLaunchArgs], FULL)
            assert.strict.equal(Object.isFrozen(chromiumLaunchArgs), true)
        }, false)
    })

})
