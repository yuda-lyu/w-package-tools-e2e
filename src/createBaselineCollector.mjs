import fs from 'fs'
import path from 'path'
import { AsyncLocalStorage } from 'async_hooks'


//目前作用中之案例範圍(以非同步脈絡界定; 同一行程內並行之案例互不混入)
//範圍物件 { c: 收集器|null, id: 該次 run 之序號, enabledAncestor: 祖先是否有啟用之收集範圍, callTag: 案例末單張比對之標記 }
let store = new AsyncLocalStorage()


/**
 * 取得目前作用中之案例收集器(collector.run或runBaselineCase收集模式之範圍內，且為該收集器目前這一次run)，否則回傳null
 *
 * 前一次run遺留之非同步工作即使同一收集器正在下一次run亦回傳null(其比對照常立即拋錯)
 *
 * @returns {Object|null} 回傳收集器物件或null
 */
export function activeBaselineCollector() {
    let s = store.getStore()
    return s && s.c && s.c.open && s.c.runId === s.id ? s.c : null
}


/**
 * 目前是否位於啟用之收集範圍內(含被runOutsideCollector遮蔽之祖先範圍)；產製端據以判定互斥
 *
 * @returns {Boolean} 回傳布林值
 */
export function insideEnabledCollect() {
    let s = store.getStore()
    if (!s) {
        return false
    }
    let a = activeBaselineCollector()
    return !!((a && a.enabled) || s.enabledAncestor)
}


/**
 * 於任何收集器範圍之外執行fn(遮蔽外層收集器；runBaselineCase未啟用收集時用以避免巢狀案例被外層收集)；仍記住祖先有啟用之收集範圍，供產製端互斥判定
 *
 * @param {Function} fn 輸入函數
 * @returns {*} 回傳fn之回傳值
 */
export function runOutsideCollector(fn) {
    return store.run({ c: null, id: 0, enabledAncestor: insideEnabledCollect(), callTag: null }, fn)
}


/**
 * 在目前範圍內加上單張比對之標記執行fn(runBaselineCase用以判定該張比對是否已自行記錄)
 *
 * @param {Object} tag 輸入標記物件
 * @param {Function} fn 輸入函數
 * @returns {*} 回傳fn之回傳值
 */
export function runTaggedCall(tag, fn) {
    let s = store.getStore()
    return store.run({ ...(s || { c: null, id: 0, enabledAncestor: false }), callTag: tag }, fn)
}


//測試框架之略過訊號(mocha 之 this.skip() 拋出 Pending): 已收集不符時失敗優先, 不讓略過掩蓋
function isSkipSignal(err) {
    return !!(err && typeof err === 'object' && err.constructor && err.constructor.name === 'Pending')
}


//證據檔名用之標籤(同assertBaselineMatch: 非[\w.-]者替換為底線)
function safeName(s) {
    return String(s).replace(/[^\w.-]/g, '_')
}


//各狀態於彙整訊息之括號文字
function stateText(r) {
    if (r.status === 'diff') {
        return `${r.numDiff}px`
    }
    if (r.status === 'size') {
        return '尺寸不同'
    }
    if (r.status === 'missing') {
        return '缺標準圖'
    }
    return '比對錯誤'
}


//各狀態之明細行
function detailText(r) {
    if (r.status === 'diff') {
        return `diff=${r.numDiff}px > maxDiffPixels=${r.maxDiffPixels} → ${r.stem}__{capture,baseline,diff}.png`
    }
    if (r.status === 'size') {
        return `尺寸不同 cap=${r.capSize} base=${r.baseSize} → ${r.stem}__{capture,baseline}.png`
    }
    if (r.status === 'missing') {
        return `標準圖不存在 ${r.baselinePath} → ${r.stem}__capture.png(候選標準圖)`
    }
    return `${String(r.message || '').split('\n')[0]}`
}


/**
 * 建立以案例為單位之標準圖比對收集器(收集模式)：比對不符時記錄並續拍，案例末才拋一個固定格式之彙整錯誤
 *
 * 啟用：enabled未給時依環境變數E2E_COLLECT==='1'；未啟用之收集器不收集(其範圍內之assertBaselineMatch照常首張不符即拋錯)。
 * 範圍：collector.run(fn)於fn之非同步脈絡內設為作用中收集器，範圍內assertBaselineMatch(未給opt.collect)之比對結果記入之；
 * 範圍外不收集(照常立即拋錯)，故不會有「記了卻沒人彙整」之假綠。runBaselineCase於收集模式自行建立並套用，不必另呼叫。
 * 紀錄：每次比對一筆{label,status,numDiff,maxDiffPixels,capSize,baseSize,baselinePath,stem,message}，status為'pass'、'diff'(超過容差)、'size'(尺寸不同)、'missing'(缺標準圖)或'error'(比對函數拋出之其他錯誤)。
 * 彙整錯誤之訊息固定格式(首行可解析)：
 * `截圖與標準圖不一致 ×<不符張數>/<比對張數> [<案例鍵>]: <標籤>(<狀態>), ...`，狀態為`<N>px`、`尺寸不同`、`缺標準圖`或`比對錯誤`(標籤只含[\w.-])；
 * 其後每張一行`  - <標籤>: <明細> → <證據檔>`；錯誤物件另帶baselineCollect:{caseKey,records}(含通過者，即每一階段之狀態)。
 * 案例因其他錯誤(語意斷言、操作逾時等)失敗時：以該錯誤為準原樣拋出(不改訊息)，若已收集不符則另印一行`[baseline-collect] <同上首行> (案例另因錯誤失敗, 以該錯誤為準)`並於該錯誤掛baselineCollect
 * (清單或日誌本身失敗時不取代原錯誤，改記於baselineCollect.sideErrors)。
 * 有不符時另寫案例清單`<目錄>/<案例鍵>__<時間戳>__collect.json`({caseKey,outcome:'mismatch'|'failed',error,cwd,records})供審查與採用工具(reviewPendingShots/acceptPendingShots)辨識；
 * 寫入每個有證據檔之目錄(與證據同處；皆無則pendingDir)，檔名排他建立；outcome為'failed'(案例另因錯誤失敗，或有「比對錯誤」)者其截圖不得採用。
 * 範圍之開閉：run執行期間open為true，結束即false；每次run有自己的序號，前一次run遺留之非同步工作(未等待之計時器等)即使同一收集器正在下一次run亦不收集，
 * 明示之收集器物件須即目前非同步脈絡之作用中收集器才收集(範圍外或他案例脈絡傳入皆照常立即拋錯)；同一收集器之run不可重疊。
 * 祖先有啟用之收集範圍者(含經runOutsideCollector遮蔽)，insideEnabledCollect()為true，runBaselineCase產製端據以拒絕。
 * fn以測試框架之略過訊號(mocha this.skip()拋出之Pending)結束而已收集不符時，失敗優先：改拋彙整錯誤。
 * deferIfMismatch()：已收集不符時拋延後彙整之標記錯誤(runBaselineCase於呼叫onKnownDefect前用)，run於收尾之後才轉成彙整錯誤並寫清單；收尾另拋錯者以該錯誤為準
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.caseKey=''] 輸入案例鍵字串(彙整訊息與清單檔名用)，預設''
 * @param {Boolean} [opt.enabled] 輸入是否啟用布林值，預設依環境變數E2E_COLLECT==='1'
 * @param {Object} [opt.env=process.env] 輸入環境變數物件，預設process.env
 * @param {String} [opt.pendingDir='./testPending'] 輸入案例清單之預設目錄字串，預設'./testPending'
 * @param {Boolean} [opt.manifest=true] 輸入有不符時是否寫案例清單布林值，預設true
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Object} 回傳收集器物件{caseKey,enabled,open,runId,records,add(rec),mismatches(),summary(),flush(),attach(err),deferIfMismatch(),run(fn)}
 * @example
 *
 * import createBaselineCollector from 'w-package-tools-e2e/src/createBaselineCollector.mjs'
 * import assertBaselineMatch from 'w-package-tools-e2e/src/assertBaselineMatch.mjs'
 *
 * //不經runBaselineCase、於案例內逐階段比對之專案: 以案例為單位包住(E2E_COLLECT=1 時收集, 未設時照常首張不符即拋)
 * it('sso-edit-eng-E2E-009', async function() {
 *     await createBaselineCollector({ caseKey: 'sso-edit-eng-E2E-009' }).run(async () => {
 *         assertBaselineMatch(await shot1(page), pathOf('eng', 'E2E-009-1-a'), 'sso-edit-eng-E2E-009-1-a')
 *         assertBaselineMatch(await shot2(page), pathOf('eng', 'E2E-009-2-b'), 'sso-edit-eng-E2E-009-2-b')
 *     }) //有不符即於此拋「截圖與標準圖不一致 ×n/2 [sso-edit-eng-E2E-009]: ...」
 * })
 *
 */
function createBaselineCollector(opt = {}) {
    let { caseKey = '', enabled, env = process.env, pendingDir = './testPending', manifest = true, log = console.log } = opt
    if (enabled === undefined || enabled === null) {
        enabled = env.E2E_COLLECT === '1'
    }
    let records = []

    function add(rec) {
        let r = { ...rec, label: safeName(rec.label || '') }
        //案例末單張比對之標記(不可列舉, 不入清單): 供 runBaselineCase 判定該張是否已自行記錄
        let s = store.getStore()
        if (s && s.callTag) {
            Object.defineProperty(r, 'callTag', { value: s.callTag, enumerable: false })
        }
        records.push(r)
        return r
    }

    function mismatches() {
        return records.filter((r) => r.status !== 'pass')
    }

    function summary() {
        let mm = mismatches()
        if (mm.length === 0) {
            return ''
        }
        return `截圖與標準圖不一致 ×${mm.length}/${records.length} [${caseKey}]: ${mm.map((r) => `${r.label}(${stateText(r)})`).join(', ')}`
    }

    //案例清單: 寫入每個有證據之目錄(皆無則 pendingDir), 檔名排他建立(跨行程同毫秒不互蓋); 回傳寫出之路徑陣列
    //各目錄各自嘗試(一個目錄失敗不影響其餘), 有失敗者於全部嘗試後拋錯(錯誤帶 written: 已寫出者)
    function writeManifest(outcome, err) {
        let mm = mismatches()
        if (!manifest || mm.length === 0) {
            return []
        }
        let dirs = [...new Set(mm.filter((r) => r.stem).map((r) => path.dirname(r.stem)))]
        if (dirs.length === 0) {
            dirs = [pendingDir]
        }
        let firstErr = records.find((r) => r.status === 'error')
        let data = { caseKey, outcome, error: err ? String(err.message || err) : (firstErr ? String(firstErr.message || '') : null), cwd: process.cwd(), records }
        let text = JSON.stringify(data, null, 2)
        let ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
        let out = []
        let fails = []
        for (let dir of dirs) {
            try {
                fs.mkdirSync(dir, { recursive: true })
                for (let n = 0; ; n++) {
                    let fp = path.join(dir, `${safeName(caseKey || 'case')}__${ts}${n > 0 ? `-${n}` : ''}__collect.json`)
                    try {
                        fs.writeFileSync(fp, text, { flag: 'wx' })
                        out.push(fp)
                        break
                    }
                    catch (e) {
                        if (e.code !== 'EEXIST') {
                            throw e
                        }
                    }
                }
            }
            catch (e) {
                fails.push(`${dir}: ${e.message}`)
            }
        }
        if (fails.length > 0) {
            let e = new Error(fails.join('; '))
            e.written = out
            throw e
        }
        return out
    }

    //有不符即寫清單並拋彙整錯誤; 之後清空紀錄(收集器可續用)
    //有「比對錯誤」者案例清單之 outcome 為 'failed'(該案比對未能完成, 其餘證據亦不可採用)
    function flush() {
        let head = summary()
        if (!head) {
            records.length = 0
            return
        }
        let lines = [head, ...mismatches().map((r) => `  - ${r.label}: ${detailText(r)}`)]
        try {
            let mf = writeManifest(records.some((r) => r.status === 'error') ? 'failed' : 'mismatch', null)
            if (mf.length > 0) {
                lines.push(`  (案例清單 ${mf.join('; ')})`)
            }
        }
        catch (e) {
            if (Array.isArray(e.written) && e.written.length > 0) {
                lines.push(`  (案例清單 ${e.written.join('; ')})`)
            }
            lines.push(`  (案例清單寫入失敗: ${e.message})`)
        }
        let e = new Error(lines.join('\n'))
        e.baselineCollect = { caseKey, records: records.slice() }
        records.length = 0
        throw e
    }

    //案例因其他錯誤失敗: 不改該錯誤, 已收集之不符以日誌一行、清單與 err.baselineCollect 呈現; 之後清空紀錄
    //清單或日誌本身失敗時不取代原錯誤, 改記於 err.baselineCollect.sideErrors
    function attach(err) {
        let head = summary()
        if (head) {
            let side = []
            try {
                writeManifest('failed', err)
            }
            catch (e) {
                side.push(`案例清單寫入失敗: ${e.message}`)
            }
            try {
                if (typeof log === 'function') {
                    log(`[baseline-collect] ${head} (案例另因錯誤失敗, 以該錯誤為準)`)
                }
            }
            catch (e) {
                side.push(`日誌失敗: ${e.message}`)
            }
            if (err && typeof err === 'object' && !err.baselineCollect) {
                try {
                    err.baselineCollect = side.length > 0 ? { caseKey, records: records.slice(), sideErrors: side } : { caseKey, records: records.slice() }
                }
                catch (e) {}
            }
        }
        records.length = 0
    }

    let collector = {
        caseKey,
        enabled: !!enabled,
        open: false,
        runId: 0,
        records,
        add,
        mismatches,
        summary,
        flush,
        attach,
    }

    //已收集不符時拋一個延後彙整之標記錯誤(不寫清單、不清空): 由 run 於收尾之後轉成彙整錯誤; 收尾另拋錯者則以該錯誤為準(清單 outcome 為 failed)
    collector.deferIfMismatch = () => {
        if (mismatches().length > 0) {
            let e = new Error(`[baseline-collect] ${caseKey}: 已收集截圖與標準圖不一致, 案例末彙整`)
            e.baselineCollectDeferred = collector
            throw e
        }
    }

    //於fn之非同步脈絡內設為作用中收集器(open 期間); fn正常結束則flush(有不符即拋彙整錯誤), 拋錯則attach後原樣拋出
    //每次 run 有自己的序號: 結束後(或下一次 run 期間)fn 遺留之非同步工作不再收集, 其比對照常立即拋錯; 同一收集器之 run 不可重疊
    //fn 以測試框架之略過訊號(mocha this.skip())結束而已收集不符者, 失敗優先: 改拋彙整錯誤
    collector.run = async (fn) => {
        if (collector.open) {
            throw new Error(`createBaselineCollector: ${caseKey} 之 run 不可重疊(同一收集器同時只能有一次 run)`)
        }
        let enabledAncestor = insideEnabledCollect()
        collector.runId += 1
        let scope = { c: collector, id: collector.runId, enabledAncestor, callTag: null }
        let r
        collector.open = true
        try {
            r = await store.run(scope, fn)
        }
        catch (err) {
            collector.open = false
            if (err && (err.baselineCollectDeferred === collector || (isSkipSignal(err) && mismatches().length > 0))) {
                flush()
            }
            attach(err)
            throw err
        }
        collector.open = false
        flush()
        return r
    }

    return collector
}


export default createBaselineCollector
