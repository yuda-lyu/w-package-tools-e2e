import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'


/**
 * 逐檔隔離執行e2e：每個e2e檔以獨立之mocha行程執行，檔與檔之間由beforeEachFile換新後端等狀態
 *
 * why：多個e2e檔塞在單一mocha行程時，會共用被前面測試改過狀態之後端(記憶體內計數、快取、換過設定之實例、RPC正規化過之欄位順序)，
 * 與各檔單獨產製標準圖之環境不同；逐檔各給全新後端即回到單獨執行之狀態。前端通常無狀態且啟動慢，由各檔之startServersOnce沿用。
 * 測試檔以pattern於testDir動態列舉(新增之檔自動納入，不因寫死清單而靜默漏跑)，依檔名排序執行。
 * 只重跑受改動影響之案例時(依差異範圍驗證)，以targets逐檔指定檔案與--grep：每檔仍換新後端，並自動加--fail-zero(grep對不到任何案例時失敗，不假綠)。
 * 殺port等屬專案政策，一律以beforeEachFile/afterAll回呼注入，本函數不殺任何行程
 *
 * 啟動方式：有mocha執行檔(mochaBin，預設projRoot下之node_modules/mocha/bin/mocha.js)時以目前之node直接執行之(不經shell)，否則沿用npx mocha(Windows下經shell)。
 * why：Windows下npx須經cmd.exe，參數被拼接成一行後由cmd.exe重新解析(2026-09-30實測)：| & 切出另一指令(如'E2E-0(0[2-9]|1[0-5])-'被切成管線而exit 255)，
 * < > 為轉向(> 把輸出寫成cwd下之檔案且exit 0)，^ 與 " 被吃掉、空白拆成多個參數、%名稱% 展開為環境變數(皆exit 0，靜默改變篩選)；
 * 括號、[ ]、! , ; = * ? \ 與中文原樣傳遞。Node 24另警告DEP0190。故經npx且於Windows時，參數含空白或 " & | < > ^ % 即於執行前拋錯，不跑被改寫之指令。
 * mocha執行檔之路徑一律以projRoot解析為絕對路徑(spawn之cwd為projRoot，相對路徑會被重複疊加)；明確給定之mochaBin不存在即拋錯，不默默改用npx。
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.projRoot 輸入專案根目錄字串(mocha之工作目錄)
 * @param {String} opt.testDir 輸入測試檔目錄字串
 * @param {RegExp} [opt.pattern=/^e2e-.*\.test\.mjs$/] 輸入測試檔名樣式，預設/^e2e-.*\.test\.mjs$/，有給targets時不使用
 * @param {Array} [opt.targets] 輸入指定執行之目標陣列，元素為檔名字串或{file,grep}物件，依陣列順序執行；有grep者附加['--grep',grep,'--fail-zero']；檔案不存在即拋錯。未給時依pattern列舉
 * @param {Function} [opt.beforeEachFile] 輸入每檔執行前之回呼(可回傳Promise)，傳入檔名，預設無動作
 * @param {Function} [opt.afterAll] 輸入全部執行後之回呼(可回傳Promise)，預設無動作
 * @param {Array} [opt.mochaArgs=['--reporter','list','--timeout','300000']] 輸入附加於檔案路徑後之mocha參數陣列
 * @param {String} [opt.mochaBin] 輸入mocha執行檔路徑字串(相對路徑以projRoot解析)，預設為projRoot下之node_modules/mocha/bin/mocha.js，預設者不存在時改用npx；明確給定而不存在即拋錯
 * @param {Function} [opt.spawnSyncFn=spawnSync] 輸入同步spawn函數(供測試注入)，預設spawnSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串(供測試注入)，預設process.platform
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳物件{results,failed}，results為[{file,code}](有grep者另含grep)，failed為失敗檔數
 * @example
 *
 * import runIsolatedE2e from 'w-package-tools-e2e/src/runIsolatedE2e.mjs'
 * import killPortListeners from 'w-package-tools-e2e/src/killPortListeners.mjs'
 *
 * let { failed } = await runIsolatedE2e({
 *     projRoot, testDir,
 *     beforeEachFile: async () => { killPortListeners(11007); await new Promise((r) => setTimeout(r, 2000)) },
 *     afterAll: () => { killPortListeners(11007) },
 * })
 * process.exit(failed === 0 ? 0 : 1)
 *
 * //只重跑受影響之案例(每檔仍換新後端)
 * await runIsolatedE2e({
 *     projRoot, testDir,
 *     targets: [{ file: 'e2e-adduser.test.mjs', grep: 'E2E-0(0[2-9]|1[0-5])-' }, { file: 'e2e-ips.test.mjs', grep: 'E2E-004-' }],
 *     beforeEachFile, afterAll,
 * })
 *
 */
async function runIsolatedE2e(opt = {}) {
    let {
        projRoot,
        testDir,
        pattern = /^e2e-.*\.test\.mjs$/,
        targets = null,
        beforeEachFile = async () => {},
        afterAll = async () => {},
        mochaArgs = ['--reporter', 'list', '--timeout', '300000'],
        mochaBin = null,
        spawnSyncFn = spawnSync,
        platform = process.platform,
        log = console.log,
    } = opt
    if (!projRoot || !testDir) {
        throw new Error('runIsolatedE2e: projRoot 與 testDir 為必填')
    }
    let isWin = platform === 'win32'
    let rel = path.relative(projRoot, testDir)

    //執行清單: targets 依給定順序; 否則依 pattern 列舉並排序
    let items
    if (Array.isArray(targets)) {
        items = targets.map((t) => (typeof t === 'string' ? { file: t, grep: '' } : { file: t.file, grep: t.grep || '' }))
        let lack = items.filter((t) => !t.file || !fs.existsSync(path.join(testDir, t.file))).map((t) => t.file)
        if (lack.length > 0) {
            throw new Error(`runIsolatedE2e: targets 之檔案不存在: ${lack.join(', ')}`)
        }
    }
    else {
        items = fs.readdirSync(testDir).filter((f) => pattern.test(f)).sort().map((f) => ({ file: f, grep: '' }))
    }

    //mocha 啟動方式: 有 mocha 執行檔即以 node 直接執行(不經 shell), 否則 npx; 路徑以 projRoot 解析為絕對路徑(spawn 之 cwd 為 projRoot)
    let bin = path.resolve(projRoot, mochaBin || path.join('node_modules', 'mocha', 'bin', 'mocha.js'))
    let useNode = fs.existsSync(bin)
    if (mochaBin && !useNode) {
        throw new Error(`runIsolatedE2e: mochaBin 不存在: ${bin}`)
    }

    //Windows 下之 npx 退路經 cmd.exe 重新解析參數: 含空白或 " & | < > ^ % 者會被拆開、吃掉、展開或轉向, 執行前即拋錯(一個都不跑)
    if (!useNode && isWin) {
        let bad = items
            .flatMap(({ file, grep }) => [path.join(rel, file), ...mochaArgs, ...(grep ? [grep] : [])])
            .filter((a, i, arr) => /[\s"&|<>^%]/.test(a) && arr.indexOf(a) === i)
        if (bad.length > 0) {
            throw new Error(`runIsolatedE2e: 無本地 mocha, 經 npx(cmd.exe)執行時下列參數含空白或 " & | < > ^ % 會被改寫: ${bad.join(', ')}; 請將 mocha 裝為 devDependency 或以 mochaBin 指定`)
        }
    }

    let results = []
    for (let { file, grep } of items) {
        await beforeEachFile(file)
        log(`\n=== [run-e2e-isolated] 執行 ${file}${grep ? ` --grep ${grep}` : ''}（全新後端）===`)
        let args = [path.join(rel, file), ...mochaArgs, ...(grep ? ['--grep', grep, '--fail-zero'] : [])]
        let r = useNode
            ? spawnSyncFn(process.execPath, [bin, ...args], { cwd: projRoot, stdio: 'inherit', shell: false })
            : spawnSyncFn('npx', ['mocha', ...args], { cwd: projRoot, stdio: 'inherit', shell: isWin })
        results.push(grep ? { file, grep, code: r.status } : { file, code: r.status })
    }
    await afterAll()

    log('\n=== [run-e2e-isolated] 逐檔結果 ===')
    let failed = 0
    for (let { file, grep, code } of results) {
        log(`  ${code === 0 ? '✔' : '✘'} ${file}${grep ? ` --grep ${grep}` : ''} (exit ${code})`)
        if (code !== 0) {
            failed++
        }
    }
    log(`\n${failed === 0 ? '✔ e2e 全部通過' : `✘ ${failed} 個 e2e 檔失敗`}`)
    return { results, failed }
}


export default runIsolatedE2e
