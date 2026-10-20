import fs from 'fs'
import path from 'path'
import normalizeShots from './normalizeShots.mjs'
import openCasePage from './openCasePage.mjs'
import assertBaselineMatch from './assertBaselineMatch.mjs'


/**
 * 單一案例之標準圖管線：產製端(regen)與比對端(compare)呼叫同一函數，使兩端之瀏覽器取得、每案fresh、前置、執行、語意斷言與順序逐項對稱
 *
 * 順序：prepare(開瀏覽器前，例如資料庫重置) → launch → openPage → beforeRun → run → 正規化截圖 → semantic → verify →
 * 產製端：依gate逐張決定是否寫檔(全部斷言通過後才寫，任何斷言失敗則該案一張都不寫)；比對端：逐張assertBaselineMatch →
 * finally關閉瀏覽器(若run中換了瀏覽器，以ctx.browserRef.current為準)並呼叫afterCase。
 * 各掛鉤皆收到ctx物件{mode,lang,name,browser,browserRef,page,shots,result}，可依ctx.mode分流(例如只能在測試框架內執行之檢查)。
 *
 * 已知缺陷(createKnownDefect)分兩種：
 * 整案已知缺陷(錯誤不帶shots，由run或掛鉤拋出皆可)：產製端略過該案不寫圖並回傳status為'knownDefect'，比對端呼叫onKnownDefect(例如mocha之this.skip)，未給則原樣拋出；
 * 部分已知缺陷(錯誤帶shots，缺陷落在案例後段，僅能由run拋出)：缺陷之前已取得之截圖(err.shots，形狀同run之回傳，含{shots,page}換頁)照常走同一條管線——須與stages及defectStages併用，
 * 圖鍵須三向相符(多：shots有而stages沒有；重疊：shots含defectStages之鍵；少：stages有而shots與defectStages都沒有，任一成立即拋錯，一張都不寫)，
 * 之後仍先過semantic與verify(ctx.knownDefect為該錯誤、ctx.shots為前段截圖，既有掛鉤須能分流)，
 * 產製端依gate寫出前段(缺陷步之圖鍵不產，印[known-defect]與未產圖鍵，回傳status仍為'knownDefect'並帶defectStages)，
 * 比對端逐張比對前段，全部一致才呼叫onKnownDefect(任一張不符或缺檔即拋比對錯誤，不呼叫onKnownDefect，前段回歸不被pending掩蓋)。
 * 帶shots之已知缺陷僅能由run拋出，由run之前之階段或semantic/verify拋出者視同一般錯。
 * 缺陷修復後run不再拋缺陷而走完全部階段，即回到正常路徑(stages檢查仍為全部圖鍵)。
 * 有給gate時，缺陷分支自動呼叫gate.noteKnownDefect記下因缺陷未產之圖鍵，使finalize不把它們當成--names未命中
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.mode 輸入模式字串，'regen'或'compare'
 * @param {String} opt.lang 輸入語系字串
 * @param {String} opt.name 輸入案例鍵字串
 * @param {Function} opt.launch 輸入開瀏覽器函數，async()=>Browser
 * @param {Function} opt.run 輸入案例執行函數，async(page,lang,ctx)=>Buffer|{圖鍵:Buffer}|[{name,buf}]|{buf|shots,page}|null
 * @param {Function} opt.pathOf 輸入標準圖路徑函數，(lang,圖鍵)=>路徑字串
 * @param {Function} [opt.openPage] 輸入開頁函數，async(browser,ctx)=>Page，預設openCasePage(browser)
 * @param {Function} [opt.prepare] 輸入開瀏覽器前之前置函數，async(ctx)
 * @param {Function} [opt.beforeRun] 輸入開頁後、執行前之前置函數，async(ctx)
 * @param {Function} [opt.semantic] 輸入語意斷言函數，async(ctx)，寫檔或比對前必過；部分已知缺陷時亦執行，ctx.knownDefect為該錯誤
 * @param {Function} [opt.verify] 輸入資料庫或端到端不變式檢查函數，async(ctx)，寫檔或比對前必過；部分已知缺陷時亦執行，ctx.knownDefect為該錯誤
 * @param {Function} [opt.afterCase] 輸入收尾函數(finally，關瀏覽器之後)，async(ctx)
 * @param {Function} [opt.labelOf] 輸入比對失敗證據檔名標籤函數，(lang,圖鍵)=>字串，預設標準圖檔名
 * @param {Object} [opt.gate=null] 輸入createBaselineGate之篩選器，產製端用；null代表全寫至pathOf
 * @param {Array} [opt.stages=null] 輸入宣告之圖鍵陣列，給定時產出之圖鍵集合須與之相同(防宣告、產製、比對三處命名不同步)，預設null不檢查
 * @param {Array} [opt.defectStages=null] 輸入缺陷步之圖鍵字串陣列(須為stages之子集且須與stages併用，空陣列等同未給)，預設null；run拋帶shots之已知缺陷時，這些圖鍵不產不比，其餘stages須由shots補齊
 * @param {Boolean} [opt.compareOnly=false] 輸入是否為只比對之案例(共用他案標準圖)布林值；產製端照常執行並驗語意斷言但一張都不寫(避免共用圖被兩案重寫)，回傳status為'compareOnly'，預設false
 * @param {Boolean} [opt.allowEmpty=false] 輸入是否允許案例不產生任何截圖布林值，預設false(無截圖即拋錯，防比對端空轉假綠)
 * @param {Boolean} [opt.compareAll=false] 輸入比對端是否比完全部階段再彙總拋錯布林值，預設false(首張不符即拋)
 * @param {Function} [opt.onKnownDefect=null] 輸入比對端遇已知缺陷之處理函數，async(err)，預設null代表原樣拋出；部分已知缺陷時於前段全部比對通過後才呼叫
 * @param {Function} [opt.match=assertBaselineMatch] 輸入比對函數(buf,baselinePath,label)，預設assertBaselineMatch
 * @param {Function} [opt.writeFile] 輸入寫檔函數(path,buf)，預設建立上層目錄後fs.writeFileSync
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳物件{status,shots,written,kept,skipped}，status為'regen'、'compare'、'compareOnly'或'knownDefect'；部分已知缺陷時另帶defectStages(缺陷步圖鍵陣列)，shots為前段圖鍵
 * @example
 *
 * import runBaselineCase from 'w-package-tools-e2e/src/runBaselineCase.mjs'
 *
 * //比對端(mocha)
 * it(name, async function() {
 *     await runBaselineCase({ mode: 'compare', lang, name, launch: launchBrowser, run: fn, semantic, pathOf, onKnownDefect: () => this.skip() })
 * })
 * //產製端(直跑 --baseline)
 * await runBaselineCase({ mode: 'regen', lang, name, launch: launchBrowser, run: fn, semantic, pathOf, gate })
 *
 * //部分已知缺陷: 第4步走到缺陷, 前3步之標準圖照常產製與比對
 * let stages = ['E2E-018-1-a', 'E2E-018-2-b', 'E2E-018-3-c', 'E2E-018-4-d']
 * let run = async (page, lang) => {
 *     let shots = {}
 *     shots['E2E-018-1-a'] = await captureStep1(page)
 *     shots['E2E-018-2-b'] = await captureStep2(page)
 *     shots['E2E-018-3-c'] = await captureStep3(page)
 *     if (await hasDefectSymptom(page)) {
 *         throw createKnownDefect('第4步全不選後出現空白表格', { ref: 'spec/流程_xxx.md 已知落差 2026-10-20', shots })
 *     }
 *     shots['E2E-018-4-d'] = await captureStep4(page)
 *     return shots
 * }
 * await runBaselineCase({ mode: 'regen', lang, name, launch: launchBrowser, run, pathOf, gate, stages, defectStages: ['E2E-018-4-d'] })
 *
 */
async function runBaselineCase(opt = {}) {
    let {
        mode,
        lang,
        name,
        launch,
        run,
        pathOf,
        openPage = (browser) => openCasePage(browser),
        prepare = null,
        beforeRun = null,
        semantic = null,
        verify = null,
        afterCase = null,
        labelOf = (lg, key) => path.basename(pathOf(lg, key), '.png'),
        gate = null,
        stages = null,
        defectStages = null,
        compareOnly = false,
        allowEmpty = false,
        compareAll = false,
        onKnownDefect = null,
        match = assertBaselineMatch,
        writeFile = (p, buf) => {
            fs.mkdirSync(path.dirname(p), { recursive: true })
            fs.writeFileSync(p, buf)
        },
        log = console.log,
    } = opt
    if (mode !== 'regen' && mode !== 'compare') {
        throw new Error(`runBaselineCase: mode 須為 'regen' 或 'compare'，實得「${mode}」`)
    }
    if (!lang || !name || typeof launch !== 'function' || typeof run !== 'function' || typeof pathOf !== 'function') {
        throw new Error('runBaselineCase: lang、name、launch、run、pathOf 為必填')
    }
    //defectStages 組態檢查(開瀏覽器前; 組態錯誤不應被當成案例失敗); 空陣列等同未給(無缺陷步可豁免, 不強制併用 stages)
    if (Array.isArray(defectStages) && defectStages.length === 0) {
        defectStages = null
    }
    if (defectStages !== null) {
        if (!Array.isArray(defectStages) || defectStages.some((k) => typeof k !== 'string' || k === '')) {
            throw new Error('runBaselineCase: defectStages 須為圖鍵字串陣列')
        }
        if (!Array.isArray(stages)) {
            throw new Error('runBaselineCase: defectStages 須與 stages 併用(部分已知缺陷須以完整宣告核對前段圖鍵)')
        }
        let bad = defectStages.filter((k) => !stages.includes(k))
        if (bad.length > 0) {
            throw new Error(`runBaselineCase: ${lang}-${name} defectStages 含不在 stages 內之圖鍵 [${bad.join(', ')}]`)
        }
    }
    //告知篩選器標準圖路徑函數, 供其 finalize() 做孤兒檢查(篩選器建立時已給 pathOf 者不覆寫)
    if (gate && typeof gate.usePathOf === 'function') {
        gate.usePathOf(pathOf)
    }
    let gateNotes = gate && typeof gate.noteKnownDefect === 'function'

    let ctx = { mode, lang, name, browser: null, browserRef: { current: null }, page: null, shots: [], result: undefined }
    let out = { status: mode, shots: [], written: [], kept: [], skipped: [] }

    //產製端逐張寫檔(正常路徑與部分已知缺陷路徑共用同一份, 避免兩份碼分歧)
    let writeShots = (shots) => {
        for (let s of shots) {
            if (gate && !gate.shouldWrite(lang, name, s.key)) {
                out.skipped.push(s.key)
                log(`  [skip] ${lang}-${s.key}`)
                continue
            }
            let base = pathOf(lang, s.key)
            let reason = ''
            if (gate) {
                gate.noteProduced(lang, name, s.key)
                let d = gate.decideWrite(s.buf, base)
                if (!d.write) {
                    out.kept.push(s.key)
                    log(`  [keep] ${lang}-${s.key} (${d.reason})`)
                    continue
                }
                reason = d.reason
            }
            let target = gate ? gate.outPath(base) : base
            writeFile(target, s.buf)
            out.written.push(s.key)
            //寫出者亦印出(含 decideWrite 之原因, 如 diff=661px), 與 [keep] 對稱; 否則只能以檔案時間回推哪些圖被重產
            log(`  [write] ${lang}-${s.key}${reason ? ` (${reason})` : ''}`)
        }
    }

    //比對端逐張比對(正常路徑與部分已知缺陷路徑共用同一份)
    let compareShots = async (shots) => {
        let errs = []
        for (let s of shots) {
            try {
                await match(s.buf, pathOf(lang, s.key), labelOf(lang, s.key))
            }
            catch (err) {
                if (!compareAll) {
                    throw err
                }
                errs.push(err)
            }
        }
        if (errs.length > 0) {
            throw new Error(`${lang}-${name} 共 ${errs.length}/${shots.length} 張與標準圖不一致:\n${errs.map((e) => e.message).join('\n')}`)
        }
    }

    //run 回傳 {buf|shots,page}(執行中換頁)時, 其後之掛鉤與收尾改用新 page; 帶 shots 之已知缺陷其 err.shots 為同一形狀, 亦同
    let adoptPage = (result) => {
        if (result && typeof result === 'object' && !Buffer.isBuffer(result) && result.page && ('buf' in result || 'shots' in result)) {
            ctx.page = result.page
        }
    }

    //整案已知缺陷: 產製端不寫圖並記入gate, 比對端交 onKnownDefect(未給則原樣拋出)
    let settleWholeDefect = async (err) => {
        if (mode === 'regen') {
            log(`  [known-defect] ${lang}-${name}: ${err.message} — 不寫圖`)
            if (gateNotes) {
                gate.noteKnownDefect(lang, name, { message: err.message, ref: err.ref })
            }
            out.status = 'knownDefect'
            return out
        }
        if (typeof onKnownDefect === 'function') {
            await onKnownDefect(err)
        }
        throw err
    }

    //帶 shots 之已知缺陷僅能由 run 拋出: 其他階段拋出者視同一般錯(不被誤當部分缺陷)
    let misplacedShots = (err, where) => new Error(`runBaselineCase: ${lang}-${name} 帶 shots 之已知缺陷僅能由 run 拋出(實於 ${where} 拋出): ${err.message}`, { cause: err })

    //部分已知缺陷: 前段照常經 semantic / verify, 之後 regen 依 gate 寫出、compare 逐張比對, 全部通過才交 onKnownDefect
    let settlePartialDefect = async (err) => {
        let front = normalizeShots(err.shots, name)
        let defects = defectStages || []
        if (Array.isArray(stages)) {
            let got = new Set(front.map((s) => s.key))
            let want = new Set(stages)
            let dset = new Set(defects)
            let extra = [...got].filter((k) => !want.has(k))
            let overlap = [...got].filter((k) => dset.has(k))
            let lack = stages.filter((k) => !got.has(k) && !dset.has(k))
            if (extra.length > 0 || overlap.length > 0 || lack.length > 0) {
                throw new Error(`runBaselineCase: ${lang}-${name} 已知缺陷時產出之圖鍵與宣告不符: 多 [${extra.join(', ')}] 與 defectStages 重疊 [${overlap.join(', ')}] 少 [${lack.join(', ')}]`)
            }
        }
        //前段為空: 已宣告 stages 者由上列三向核對把關(須 defectStages 涵蓋全部 stages 才合法); 未宣告者與正常路徑一致, 須 allowEmpty
        if (front.length === 0 && !allowEmpty && !Array.isArray(stages)) {
            throw new Error(`runBaselineCase: ${lang}-${name} 未產生任何截圖 (若屬設計如此請設 allowEmpty)`)
        }
        adoptPage(err.shots)
        ctx.shots = front
        ctx.knownDefect = err
        out.shots = front.map((s) => s.key)
        out.defectStages = defects.slice()
        try {
            if (semantic) {
                await semantic(ctx)
            }
            if (verify) {
                await verify(ctx)
            }
        }
        catch (e2) {
            if (e2 && e2.knownDefect) {
                if (e2.shots !== undefined && e2.shots !== null) {
                    throw misplacedShots(e2, 'semantic/verify(缺陷路徑)')
                }
                //掛鉤另拋不帶 shots 之已知缺陷: 降級為整案已知缺陷, 與正常路徑之掛鉤拋整案缺陷一致(ctx.shots 與 out.shots 仍為 run 已取得者、不寫; ctx.knownDefect 與 out.defectStages 屬部分缺陷, 移除)
                delete ctx.knownDefect
                delete out.defectStages
                return await settleWholeDefect(e2)
            }
            throw e2
        }
        if (mode === 'regen') {
            if (compareOnly) {
                out.skipped = out.shots.slice()
            }
            else {
                writeShots(ctx.shots)
            }
            log(`  [known-defect] ${lang}-${name}: ${err.message} — 前段 ${ctx.shots.length} 張照常處理, 未產 [${defects.join(', ')}]`)
            if (gateNotes) {
                gate.noteKnownDefect(lang, name, { keys: defects, message: err.message, ref: err.ref })
            }
            out.status = 'knownDefect'
            return out
        }
        await compareShots(ctx.shots)
        if (typeof onKnownDefect === 'function') {
            await onKnownDefect(err)
        }
        throw err
    }

    //階段: setup(run之前) → run → after(run之後: stages檢查、掛鉤)
    let phase = 'setup'
    try {
        if (prepare) {
            await prepare(ctx)
        }
        ctx.browser = await launch()
        ctx.browserRef.current = ctx.browser
        ctx.page = await openPage(ctx.browser, ctx)
        if (beforeRun) {
            await beforeRun(ctx)
        }
        phase = 'run'
        let result = await run(ctx.page, lang, ctx)
        phase = 'after'
        ctx.result = result
        adoptPage(result)
        ctx.shots = normalizeShots(result, name)
        out.shots = ctx.shots.map((s) => s.key)
        if (ctx.shots.length === 0 && !allowEmpty) {
            throw new Error(`runBaselineCase: ${lang}-${name} 未產生任何截圖 (若屬設計如此請設 allowEmpty)`)
        }
        if (Array.isArray(stages)) {
            let got = new Set(out.shots)
            let want = new Set(stages)
            let extra = out.shots.filter((k) => !want.has(k))
            let lack = stages.filter((k) => !got.has(k))
            if (extra.length > 0 || lack.length > 0) {
                throw new Error(`runBaselineCase: ${lang}-${name} 產出之圖鍵與宣告不符: 多 [${extra.join(', ')}] 少 [${lack.join(', ')}]`)
            }
        }
        //語意斷言與不變式: 全部通過才寫檔 / 比對 (C13: 寫檔前語意斷言先過)
        if (semantic) {
            await semantic(ctx)
        }
        if (verify) {
            await verify(ctx)
        }

        if (mode === 'regen' && compareOnly) {
            out.status = 'compareOnly'
            out.skipped = out.shots.slice()
            log(`  [compare-only] ${lang}-${name}: 共用他案標準圖, 不寫檔`)
            return out
        }
        if (mode === 'regen') {
            writeShots(ctx.shots)
            return out
        }

        //compare
        await compareShots(ctx.shots)
        return out
    }
    catch (err) {
        if (err && err.knownDefect) {
            if (err.shots !== undefined && err.shots !== null) {
                if (phase !== 'run') {
                    throw misplacedShots(err, phase === 'setup' ? 'run 之前' : 'run 之後(semantic/verify)')
                }
                return await settlePartialDefect(err)
            }
            return await settleWholeDefect(err)
        }
        throw err
    }
    finally {
        let b = ctx.browserRef.current || ctx.browser
        if (b) {
            await b.close().catch(() => {})
        }
        if (ctx.browser && ctx.browser !== b) {
            await ctx.browser.close().catch(() => {})
        }
        if (afterCase) {
            await afterCase(ctx)
        }
    }
}


export default runBaselineCase
