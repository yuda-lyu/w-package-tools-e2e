import assert from 'assert'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import wpw from 'w-playwright'
import launchBrowser from '../src/launchBrowser.mjs'
import chromiumLaunchArgs from '../src/chromiumLaunchArgs.mjs'


//launchBrowser 經 w-playwright 之接線測試(本套件帳本 sgud/rule/rulebook_launch.md R-LB-1～R-LB-5; w-playwright 帳本 R-PW-WIRING)
//[LB01]～[LB03]、[LB05]、[LB06]: 以 spy(包住 wpw.launchChromium, 取合併前之原始選項)或替身(wpw.setBrowserTypeForTest, 取合併後之選項)驗證, 不啟動瀏覽器
//[LB04]: 替身以 next() 走真路徑, 真啟動 headless shell
//[LB07]: 子行程內不掛替身之真路徑, 真啟動 headless shell, 讀 Playwright 之 <launching> 紀錄驗實際命令列
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

    it('[LB00] 六旗標之內容為確定性渲染之契約值(不以受測陣列自比)', function() {
        assert.strict.deepEqual([...chromiumLaunchArgs], SIX)
    })

    it('[LB01] 未給opt: 呼叫wpw.launchChromium恰1次(headless、autoInstall、installDeps為true, args為六旗標); 替身恰1次, 合併後args為六旗標＋唯一之--disable-features(含Playwright預設與守門功能), ignoreDefaultArgs去掉Playwright預設串', async function() {
        await withSpy(async (raw) => {
            await withFake(async () => stub, async (calls) => {
                let r = await launchBrowser()

                //R-LB-1: launchBrowser 之唯一啟動為 wpw.launchChromium, 選項為 { headless:true, autoInstall:true, installDeps:true, ...opt, args:[...六旗標, ...opt.args] }
                assert.strict.deepEqual(raw, [{ headless: true, autoInstall: true, installDeps: true, args: [...SIX] }])

                //R-LB-2: 經 w-playwright 之 BrowserType(替身被呼叫, 依賴樹僅一份 w-playwright)
                assert.strict.equal(calls.length, 1)
                assert.strict.equal(r, stub)
                let o = calls[0]
                assert.strict.equal(o.headless, true)

                //R-LB-2: 六旗標原序在前, 合併之 --disable-features 為最後一個元素且唯一
                assert.strict.deepEqual(o.args.slice(0, 6), [...SIX])
                assert.strict.equal(o.args.length, 7)
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

    it('[LB02] opt.args附加於六旗標之後、呼叫端之--disable-features吸收進同一串; 其餘鍵原樣; opt.autoInstall可覆寫', async function() {
        await withSpy(async (raw) => {
            await withFake(async () => stub, async (calls) => {
                await launchBrowser({ args: ['--lang=en-US', '--disable-features=Translate,SomeCallerFeature'], timeout: 12345, autoInstall: false })

                //R-LB-1: ...opt 在預設之後(呼叫端可覆寫 autoInstall), args 為六旗標＋opt.args
                assert.strict.deepEqual(raw, [{ headless: true, autoInstall: false, installDeps: true, timeout: 12345, args: [...SIX, '--lang=en-US', '--disable-features=Translate,SomeCallerFeature'] }])

                //R-LB-2: 呼叫端之功能開關被吸收, 命令列仍只有一串
                assert.strict.equal(calls.length, 1)
                let o = calls[0]
                assert.strict.equal(o.timeout, 12345)
                assert.strict.deepEqual(o.args.slice(0, 7), [...SIX, '--lang=en-US'])
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

    it('[LB02b] opt.args非陣列時忽略, 只帶六旗標(行為不變)', async function() {
        await withSpy(async (raw) => {
            await withFake(async () => stub, async (calls) => {
                await launchBrowser({ args: '--lang=en-US' })
                assert.strict.deepEqual(raw[0].args, [...SIX])
                assert.strict.equal(calls.length, 1)
                assert.strict.deepEqual(calls[0].args.slice(0, 6), [...SIX])
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
            assert.strict.deepEqual(raw, [{ headless: false, channel: 'chrome', executablePath: 'C:\\x\\chrome.exe', autoInstall: false, installDeps: false, timeout: 5000, args: [...SIX, '--lang=en-US'] }])
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

    it('[LB03] opt.args含無效元素(不以-開頭)時w-playwright判整個args無效: 六旗標一併捨棄, 只留守門之一串(行為變更, README §5)', async function() {
        await withFake(async () => stub, async (calls) => {
            await launchBrowser({ args: ['not-a-switch'] })
            assert.strict.equal(calls.length, 1)
            let o = calls[0]
            //R-LB-4(行為變更): 原為 Playwright 拋錯; 現為整個 args 視為 [](守門照加)
            assert.strict.deepEqual(SIX.filter((a) => o.args.includes(a)), [])
            assert.strict.equal(o.args.length, 1)
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

    it('[LB07] 不掛替身之真路徑(子行程): 實際執行檔為headless shell; 實際命令列恰一個--disable-features, 其功能集合＝Playwright預設∪守門; 六旗標皆在命令列', async function() {
        //子行程之環境: DEBUG=pw:browser(Playwright 於載入時讀取, 寫 <launching> 紀錄); 去掉會被 w-playwright 拒絕之 PWDEBUG、SELENIUM_*
        let env = { ...process.env, DEBUG: 'pw:browser' }
        for (let k of ['PWDEBUG', 'SELENIUM_REMOTE_URL', 'SELENIUM_REMOTE_CAPABILITIES', 'SELENIUM_REMOTE_HEADERS']) {
            delete env[k]
        }
        let out = await new Promise((resolve, reject) => {
            let cp = spawn(process.execPath, [fpCmdline], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
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

        //R-LB-3: 實際命令列恰一個 --disable-features, 其集合＝Playwright 預設∪守門; 六旗標皆在
        let dis = disableArgs(toks)
        assert.strict.equal(dis.length, 1)
        let feats = featuresOf(dis[0])
        assert.strict.deepEqual([...new Set(feats)].sort(), [...new Set([...info.defaultDisableFeatures, GUARD])].sort())
        assert.strict.deepEqual(SIX.filter((a) => !toks.includes(a)), [])
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

})
