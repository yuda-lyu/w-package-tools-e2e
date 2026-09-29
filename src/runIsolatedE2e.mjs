import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'


/**
 * 逐檔隔離執行e2e：每個e2e檔以獨立之mocha行程執行，檔與檔之間由beforeEachFile換新後端等狀態
 *
 * why：多個e2e檔塞在單一mocha行程時，會共用被前面測試改過狀態之後端(記憶體內計數、快取、換過設定之實例、RPC正規化過之欄位順序)，
 * 與各檔單獨產製標準圖之環境不同；逐檔各給全新後端即回到單獨執行之狀態。前端通常無狀態且啟動慢，由各檔之startServersOnce沿用。
 * 測試檔以pattern於testDir動態列舉(新增之檔自動納入，不因寫死清單而靜默漏跑)，依檔名排序執行。
 * 殺port等屬專案政策，一律以beforeEachFile/afterAll回呼注入，本函數不殺任何行程
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.projRoot 輸入專案根目錄字串(mocha之工作目錄)
 * @param {String} opt.testDir 輸入測試檔目錄字串
 * @param {RegExp} [opt.pattern=/^e2e-.*\.test\.mjs$/] 輸入測試檔名樣式，預設/^e2e-.*\.test\.mjs$/
 * @param {Function} [opt.beforeEachFile] 輸入每檔執行前之回呼(可回傳Promise)，傳入檔名，預設無動作
 * @param {Function} [opt.afterAll] 輸入全部執行後之回呼(可回傳Promise)，預設無動作
 * @param {Array} [opt.mochaArgs=['--reporter','list','--timeout','300000']] 輸入附加於檔案路徑後之mocha參數陣列
 * @param {Function} [opt.spawnSyncFn=spawnSync] 輸入同步spawn函數(供測試注入)，預設spawnSync
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳物件{results,failed}，results為[{file,code}]，failed為失敗檔數
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
 */
async function runIsolatedE2e(opt = {}) {
    let {
        projRoot,
        testDir,
        pattern = /^e2e-.*\.test\.mjs$/,
        beforeEachFile = async () => {},
        afterAll = async () => {},
        mochaArgs = ['--reporter', 'list', '--timeout', '300000'],
        spawnSyncFn = spawnSync,
        log = console.log,
    } = opt
    if (!projRoot || !testDir) {
        throw new Error('runIsolatedE2e: projRoot 與 testDir 為必填')
    }
    let isWin = process.platform === 'win32'
    let files = fs.readdirSync(testDir).filter((f) => pattern.test(f)).sort()
    let rel = path.relative(projRoot, testDir)

    let results = []
    for (let f of files) {
        await beforeEachFile(f)
        log(`\n=== [run-e2e-isolated] 執行 ${f}（全新後端）===`)
        let r = spawnSyncFn('npx', ['mocha', path.join(rel, f), ...mochaArgs], {
            cwd: projRoot,
            stdio: 'inherit',
            shell: isWin,
        })
        results.push({ file: f, code: r.status })
    }
    await afterAll()

    log('\n=== [run-e2e-isolated] 逐檔結果 ===')
    let failed = 0
    for (let { file, code } of results) {
        log(`  ${code === 0 ? '✔' : '✘'} ${file} (exit ${code})`)
        if (code !== 0) {
            failed++
        }
    }
    log(`\n${failed === 0 ? '✔ e2e 全部通過' : `✘ ${failed} 個 e2e 檔失敗`}`)
    return { results, failed }
}


export default runIsolatedE2e
