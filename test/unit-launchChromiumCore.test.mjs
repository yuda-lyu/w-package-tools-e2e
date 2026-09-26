import assert from 'assert'
import launchChromiumCore from '../src/launchChromiumCore.mjs'


//Playwright 1.62原文(playwright-core/lib/coreBundle.js): 缺少瀏覽器執行檔、Linux缺少系統相依(兩種訊息)
let errMissing = () => new Error(`Executable doesn't exist at C:\\ms-playwright\\chromium_headless_shell-1234\\chrome-headless-shell.exe\nLooks like Playwright was just installed or updated.`)
let errDeps = () => new Error('Host system is missing dependencies to run browsers.\nPlease install them with the following command:')
let errDeps2 = () => new Error('Missing system dependencies required to run browser chromium. Install them with: sudo npx playwright install-deps chromium')
let errOther = () => new Error('Target page, context or browser has been closed')


//mkDeps, launch依序取seq之結果(為Error則拋出, 否則回傳), 記錄launch之opt與runCli之參數
function mkDeps(seq, platform = 'win32', cliFail = false) {
    let calls = { launch: [], cli: [] }
    let i = 0
    let deps = {
        launch: async (opt) => {
            calls.launch.push(opt)
            let r = seq[Math.min(i, seq.length - 1)]
            i++
            if (r instanceof Error) {
                throw r
            }
            return r
        },
        runCli: async (args) => {
            calls.cli.push(args)
            if (cliFail) {
                throw new Error('playwright install failed with exit code 1')
            }
        },
        platform,
    }
    return { deps, calls }
}


describe('launchChromiumCore', function() {

    it('瀏覽器已存在時直接啟動, 不執行CLI', async function() {
        let { deps, calls } = mkDeps(['browser'])
        let r = await launchChromiumCore({ headless: true }, deps)
        assert.strict.deepStrictEqual(r, 'browser')
        assert.strict.deepStrictEqual(calls.cli, [])
        assert.strict.deepStrictEqual(calls.launch.length, 1)
    })

    it('opt原樣傳給launch', async function() {
        let opt = { headless: true, args: ['--disable-gpu', '--force-color-profile=srgb'] }
        let { deps, calls } = mkDeps(['browser'])
        await launchChromiumCore(opt, deps)
        assert.strict.deepStrictEqual(calls.launch[0], opt)
    })

    it('缺少執行檔且為無頭(預設)時只安裝headless shell後再啟動', async function() {
        let { deps, calls } = mkDeps([errMissing(), 'browser'])
        let r = await launchChromiumCore({}, deps)
        assert.strict.deepStrictEqual(r, 'browser')
        assert.strict.deepStrictEqual(calls.cli, [['install', '--only-shell', 'chromium']])
        assert.strict.deepStrictEqual(calls.launch.length, 2)
    })

    it('缺少執行檔且為有頭時安裝完整chromium', async function() {
        let { deps, calls } = mkDeps([errMissing(), 'browser'])
        await launchChromiumCore({ headless: false }, deps)
        assert.strict.deepStrictEqual(calls.cli, [['install', '--no-shell', 'chromium']])
    })

    it('缺少執行檔且channel為chromium時安裝完整chromium', async function() {
        let { deps, calls } = mkDeps([errMissing(), 'browser'])
        await launchChromiumCore({ headless: true, channel: 'chromium' }, deps)
        assert.strict.deepStrictEqual(calls.cli, [['install', '--no-shell', 'chromium']])
    })

    it('指定系統瀏覽器(channel:chrome)時不自動安裝, 直接拋出錯誤', async function() {
        let { deps, calls } = mkDeps([errMissing()])
        await assert.rejects(launchChromiumCore({ channel: 'chrome' }, deps), /Executable doesn't exist at/)
        assert.strict.deepStrictEqual(calls.cli, [])
    })

    it('指定executablePath時不自動安裝, 直接拋出錯誤', async function() {
        let { deps, calls } = mkDeps([errMissing()])
        await assert.rejects(launchChromiumCore({ executablePath: 'C:\\x\\chrome.exe' }, deps), /Executable doesn't exist at/)
        assert.strict.deepStrictEqual(calls.cli, [])
    })

    it('安裝後仍缺少執行檔時不重複安裝, 拋出錯誤', async function() {
        let { deps, calls } = mkDeps([errMissing(), errMissing()])
        await assert.rejects(launchChromiumCore({}, deps), /Executable doesn't exist at/)
        assert.strict.deepStrictEqual(calls.cli.length, 1)
        assert.strict.deepStrictEqual(calls.launch.length, 2)
    })

    it('安裝失敗時拋出安裝錯誤, 不再啟動', async function() {
        let { deps, calls } = mkDeps([errMissing(), 'browser'], 'win32', true)
        await assert.rejects(launchChromiumCore({}, deps), /failed with exit code 1/)
        assert.strict.deepStrictEqual(calls.launch.length, 1)
    })

    it('Linux缺少系統相依時執行install-deps後再啟動', async function() {
        let { deps, calls } = mkDeps([errDeps(), 'browser'], 'linux')
        let r = await launchChromiumCore({}, deps)
        assert.strict.deepStrictEqual(r, 'browser')
        assert.strict.deepStrictEqual(calls.cli, [['install-deps', 'chromium']])
    })

    it('Linux缺少系統相依(另一種訊息)時亦執行install-deps', async function() {
        let { deps, calls } = mkDeps([errDeps2(), 'browser'], 'linux')
        await launchChromiumCore({}, deps)
        assert.strict.deepStrictEqual(calls.cli, [['install-deps', 'chromium']])
    })

    it('Linux全新環境: 先安裝瀏覽器, 再安裝系統相依, 最後啟動成功', async function() {
        let { deps, calls } = mkDeps([errMissing(), errDeps(), 'browser'], 'linux')
        let r = await launchChromiumCore({}, deps)
        assert.strict.deepStrictEqual(r, 'browser')
        assert.strict.deepStrictEqual(calls.cli, [['install', '--only-shell', 'chromium'], ['install-deps', 'chromium']])
        assert.strict.deepStrictEqual(calls.launch.length, 3)
    })

    it('非Linux缺少系統相依時不執行install-deps, 直接拋出錯誤', async function() {
        let { deps, calls } = mkDeps([errDeps()], 'win32')
        await assert.rejects(launchChromiumCore({}, deps), /missing dependencies/)
        assert.strict.deepStrictEqual(calls.cli, [])
    })

    it('install-deps後仍缺少系統相依時不重複執行, 拋出錯誤', async function() {
        let { deps, calls } = mkDeps([errDeps(), errDeps()], 'linux')
        await assert.rejects(launchChromiumCore({}, deps), /missing dependencies/)
        assert.strict.deepStrictEqual(calls.cli.length, 1)
    })

    it('其他錯誤直接拋出, 不執行CLI', async function() {
        let { deps, calls } = mkDeps([errOther()], 'linux')
        await assert.rejects(launchChromiumCore({}, deps), /has been closed/)
        assert.strict.deepStrictEqual(calls.cli, [])
        assert.strict.deepStrictEqual(calls.launch.length, 1)
    })

})
