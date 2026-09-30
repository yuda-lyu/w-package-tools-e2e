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
 * 已知缺陷(createKnownDefect)：產製端略過該案不寫圖並回傳status為'knownDefect'；比對端呼叫onKnownDefect(例如mocha之this.skip)，未給則原樣拋出
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
 * @param {Function} [opt.semantic] 輸入語意斷言函數，async(ctx)，寫檔或比對前必過
 * @param {Function} [opt.verify] 輸入資料庫或端到端不變式檢查函數，async(ctx)，寫檔或比對前必過
 * @param {Function} [opt.afterCase] 輸入收尾函數(finally，關瀏覽器之後)，async(ctx)
 * @param {Function} [opt.labelOf] 輸入比對失敗證據檔名標籤函數，(lang,圖鍵)=>字串，預設標準圖檔名
 * @param {Object} [opt.gate=null] 輸入createBaselineGate之篩選器，產製端用；null代表全寫至pathOf
 * @param {Array} [opt.stages=null] 輸入宣告之圖鍵陣列，給定時產出之圖鍵集合須與之相同(防宣告、產製、比對三處命名不同步)，預設null不檢查
 * @param {Boolean} [opt.compareOnly=false] 輸入是否為只比對之案例(共用他案標準圖)布林值；產製端照常執行並驗語意斷言但一張都不寫(避免共用圖被兩案重寫)，回傳status為'compareOnly'，預設false
 * @param {Boolean} [opt.allowEmpty=false] 輸入是否允許案例不產生任何截圖布林值，預設false(無截圖即拋錯，防比對端空轉假綠)
 * @param {Boolean} [opt.compareAll=false] 輸入比對端是否比完全部階段再彙總拋錯布林值，預設false(首張不符即拋)
 * @param {Function} [opt.onKnownDefect=null] 輸入比對端遇已知缺陷之處理函數，async(err)，預設null代表原樣拋出
 * @param {Function} [opt.match=assertBaselineMatch] 輸入比對函數(buf,baselinePath,label)，預設assertBaselineMatch
 * @param {Function} [opt.writeFile] 輸入寫檔函數(path,buf)，預設建立上層目錄後fs.writeFileSync
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳物件{status,shots,written,kept,skipped}，status為'regen'、'compare'、'compareOnly'或'knownDefect'
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
    //告知篩選器標準圖路徑函數, 供其 finalize() 做孤兒檢查(篩選器建立時已給 pathOf 者不覆寫)
    if (gate && typeof gate.usePathOf === 'function') {
        gate.usePathOf(pathOf)
    }

    let ctx = { mode, lang, name, browser: null, browserRef: { current: null }, page: null, shots: [], result: undefined }
    let out = { status: mode, shots: [], written: [], kept: [], skipped: [] }
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
        let result = await run(ctx.page, lang, ctx)
        ctx.result = result
        if (result && typeof result === 'object' && !Buffer.isBuffer(result) && result.page && ('buf' in result || 'shots' in result)) {
            ctx.page = result.page
        }
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
            for (let s of ctx.shots) {
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
            return out
        }

        //compare
        let errs = []
        for (let s of ctx.shots) {
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
            throw new Error(`${lang}-${name} 共 ${errs.length}/${ctx.shots.length} 張與標準圖不一致:\n${errs.map((e) => e.message).join('\n')}`)
        }
        return out
    }
    catch (err) {
        if (err && err.knownDefect) {
            if (mode === 'regen') {
                log(`  [known-defect] ${lang}-${name}: ${err.message} — 不寫圖`)
                out.status = 'knownDefect'
                return out
            }
            if (typeof onKnownDefect === 'function') {
                await onKnownDefect(err)
            }
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
