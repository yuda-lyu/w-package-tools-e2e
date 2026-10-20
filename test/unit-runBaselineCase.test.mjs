import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'
import runBaselineCase from '../src/runBaselineCase.mjs'
import normalizeShots from '../src/normalizeShots.mjs'
import openCasePage from '../src/openCasePage.mjs'
import createKnownDefect from '../src/createKnownDefect.mjs'
import createBaselineGate from '../src/createBaselineGate.mjs'


//案例管線之單元測試(假瀏覽器, 不啟動 Chromium): 順序、斷言先於寫檔、gate、比對、已知缺陷、換瀏覽器、空截圖


let B = (s) => Buffer.from(s)

//假瀏覽器: 記錄 newContext / newPage / close 與 dialog 掛載
function fakeBrowser(tag, log) {
    let b = {
        tag,
        closed: false,
        async newContext(o) {
            log.push(`${tag}.newContext:${JSON.stringify(o)}`)
            return {
                async newPage() {
                    log.push(`${tag}.newPage`)
                    let page = {
                        tag: `${tag}-page`,
                        dialogs: 0,
                        on(ev) {
                            if (ev === 'dialog') page.dialogs++
                        },
                    }
                    return page
                },
            }
        },
        async close() {
            b.closed = true
            log.push(`${tag}.close`)
        },
    }
    return b
}

//共用: 記錄各步驟順序之選項
function baseOpt(log, over = {}) {
    let writes = []
    let matches = []
    return {
        writes,
        matches,
        opt: {
            mode: 'regen',
            lang: 'eng',
            name: 'E2E-005-grant',
            launch: async () => {
                log.push('launch')
                return fakeBrowser('b1', log)
            },
            prepare: async () => log.push('prepare'),
            beforeRun: async () => log.push('beforeRun'),
            run: async () => {
                log.push('run')
                return { 'E2E-005-1-a': B('1'), 'E2E-005-2-b': B('2') }
            },
            semantic: async () => log.push('semantic'),
            verify: async () => log.push('verify'),
            afterCase: async () => log.push('afterCase'),
            pathOf: (lang, key) => `./test/pics/x/x-${lang}-${key}.png`,
            writeFile: (p, buf) => {
                log.push(`write:${p}`)
                writes.push([p, buf.toString()])
            },
            match: (buf, p, label) => {
                log.push(`match:${label}`)
                matches.push([p, buf.toString()])
            },
            log: () => {},
            ...over,
        },
    }
}


describe('normalizeShots', function() {
    it('Buffer / 物件 / 陣列 / {buf|shots,page} / null 之正規化', function() {
        assert.strict.deepStrictEqual(normalizeShots(B('a'), 'k').map((s) => s.key), ['k'])
        assert.strict.deepStrictEqual(normalizeShots({ a: B('1'), b: B('2') }, 'k').map((s) => s.key), ['a', 'b'])
        assert.strict.deepStrictEqual(normalizeShots([{ name: 'a', buf: B('1') }, { key: 'b', buf: B('2') }], 'k').map((s) => s.key), ['a', 'b'])
        assert.strict.deepStrictEqual(normalizeShots({ buf: B('1'), page: {} }, 'k').map((s) => s.key), ['k'])
        assert.strict.deepStrictEqual(normalizeShots({ shots: [{ name: 'a', buf: B('1') }], page: {} }, 'k').map((s) => s.key), ['a'])
        assert.strict.deepStrictEqual(normalizeShots(null, 'k'), [])
    })
    it('非 Buffer、圖鍵重複、缺鍵、不支援型別皆拋錯', function() {
        assert.throws(() => normalizeShots({ a: 'x' }, 'k'), /不是 Buffer/)
        assert.throws(() => normalizeShots([{ name: 'a', buf: B('1') }, { name: 'a', buf: B('2') }], 'k'), /圖鍵重複/)
        assert.throws(() => normalizeShots([{ buf: B('1') }], 'k'), /缺 name/)
        assert.throws(() => normalizeShots(123, 'k'), /不支援/)
    })
})


describe('openCasePage', function() {
    it('每案 newContext(透傳 contextOptions)後 newPage, 預設掛 dialog 處理器; onDialog=null 不掛', async function() {
        let log = []
        let page = await openCasePage(fakeBrowser('b', log), { contextOptions: { viewport: { width: 1440, height: 900 } } })
        assert.strict.deepStrictEqual(log, ['b.newContext:{"viewport":{"width":1440,"height":900}}', 'b.newPage'])
        assert.strict.equal(page.dialogs, 1)
        let p2 = await openCasePage(fakeBrowser('c', []), { onDialog: null })
        assert.strict.equal(p2.dialogs, 0)
    })
})


describe('runBaselineCase', function() {

    it('產製端順序: prepare → launch → openPage → beforeRun → run → semantic → verify → 寫檔 → close → afterCase', async function() {
        let log = []
        let { opt, writes } = baseOpt(log)
        let r = await runBaselineCase(opt)
        assert.strict.deepStrictEqual(log, [
            'prepare', 'launch', 'b1.newContext:{}', 'b1.newPage', 'beforeRun', 'run', 'semantic', 'verify',
            'write:./test/pics/x/x-eng-E2E-005-1-a.png', 'write:./test/pics/x/x-eng-E2E-005-2-b.png', 'b1.close', 'afterCase',
        ])
        assert.strict.deepStrictEqual(r.written, ['E2E-005-1-a', 'E2E-005-2-b'])
        assert.strict.equal(writes.length, 2)
    })

    it('語意斷言或不變式失敗: 一張都不寫, 仍關瀏覽器並收尾, 錯誤原樣拋出', async function() {
        for (let k of ['semantic', 'verify']) {
            let log = []
            let fail = async () => {
                throw new Error(`${k}-fail`)
            }
            let { opt, writes } = baseOpt(log, { [k]: fail })
            await assert.rejects(runBaselineCase(opt), new RegExp(`${k}-fail`))
            assert.strict.equal(writes.length, 0)
            assert.strict.ok(log.includes('b1.close') && log.includes('afterCase'))
        }
    })

    it('產製端配 gate: 只寫篩選命中者, 寫出路徑導至 outDir; noteProduced 使 finalize 通過', async function() {
        let gate = createBaselineGate({
            langs: ['eng'],
            cases: [{ name: 'E2E-005-grant', stages: ['E2E-005-1-a', 'E2E-005-2-b'] }],
            argv: ['node', 'x', '--baseline', '--names', 'eng-E2E-005-2-b'],
            env: { E2E_BASELINE_OUT_DIR: './test/_tmp/out' },
        })
        let log = []
        let { opt, writes } = baseOpt(log, { gate })
        let r = await runBaselineCase(opt)
        assert.strict.deepStrictEqual(r.skipped, ['E2E-005-1-a'])
        assert.strict.deepStrictEqual(writes.map((w) => w[0].split('\\').join('/')), ['test/_tmp/out/x-eng-E2E-005-2-b.png'])
        gate.finalize()
    })

    it('產製端日誌: 寫出者印 [write](配 gate 時附 decideWrite 之原因), 與保留者之 [keep] 對稱', async function() {
        let logs = []
        let { opt } = baseOpt([], { log: (s) => logs.push(s) })
        await runBaselineCase(opt)
        assert.strict.deepStrictEqual(logs, ['  [write] eng-E2E-005-1-a', '  [write] eng-E2E-005-2-b'])
        let gate = createBaselineGate({
            langs: ['eng'],
            cases: [{ name: 'E2E-005-grant', stages: ['E2E-005-1-a', 'E2E-005-2-b'] }],
            argv: ['node', 'x', '--baseline'],
            env: {},
        })
        let logs2 = []
        let { opt: opt2 } = baseOpt([], { gate, log: (s) => logs2.push(s) })
        await runBaselineCase(opt2)
        assert.strict.deepStrictEqual(logs2, ['  [write] eng-E2E-005-1-a (all)', '  [write] eng-E2E-005-2-b (all)'])
        gate.finalize()
    })

    it('比對端: 逐張 match(不寫檔); 預設首張不符即拋, compareAll 則比完再彙總', async function() {
        let log = []
        let { opt, matches, writes } = baseOpt(log, { mode: 'compare' })
        await runBaselineCase(opt)
        assert.strict.deepStrictEqual(matches.map((m) => m[1]), ['1', '2'])
        assert.strict.equal(writes.length, 0)

        let calls = []
        let failAll = (buf, p) => {
            calls.push(p)
            throw new Error(`mismatch ${p}`)
        }
        await assert.rejects(runBaselineCase(baseOpt([], { mode: 'compare', match: failAll }).opt), /mismatch/)
        assert.strict.equal(calls.length, 1)
        calls = []
        await assert.rejects(runBaselineCase(baseOpt([], { mode: 'compare', match: failAll, compareAll: true }).opt), /共 2\/2 張/)
        assert.strict.equal(calls.length, 2)
    })

    it('ctx 帶 mode 供掛鉤分流(例如只能在測試框架內執行之端到端檢查)', async function() {
        let seen = []
        let hook = async (ctx) => seen.push(`${ctx.mode}:${ctx.lang}:${ctx.name}`)
        await runBaselineCase(baseOpt([], { verify: hook }).opt)
        await runBaselineCase(baseOpt([], { mode: 'compare', verify: hook }).opt)
        assert.strict.deepStrictEqual(seen, ['regen:eng:E2E-005-grant', 'compare:eng:E2E-005-grant'])
    })

    it('已知缺陷: 產製端不寫圖回傳 knownDefect; 比對端呼叫 onKnownDefect, 未給則拋出', async function() {
        let run = async () => {
            throw createKnownDefect('儲存後出現錯誤覆蓋層', { ref: 'spec 已知落差 2026-09-27' })
        }
        let { opt, writes } = baseOpt([], { run })
        let r = await runBaselineCase(opt)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.equal(writes.length, 0)

        let got = null
        let onKnownDefect = async (e) => {
            got = e
            throw new Error('skipped')
        }
        await assert.rejects(runBaselineCase(baseOpt([], { mode: 'compare', run, onKnownDefect }).opt), /skipped/)
        assert.strict.equal(got.knownDefect, true)
        await assert.rejects(runBaselineCase(baseOpt([], { mode: 'compare', run }).opt), /已知缺陷/)
    })

    it('run 中換瀏覽器(browserRef): finally 關新舊兩個', async function() {
        let log = []
        let run = async (page, lang, ctx) => {
            let b2 = fakeBrowser('b2', log)
            ctx.browserRef.current = b2
            return B('x')
        }
        await runBaselineCase(baseOpt(log, { run }).opt)
        assert.strict.ok(log.includes('b2.close') && log.includes('b1.close'))
    })

    it('run 回 {buf,page}: 其後掛鉤取得新 page', async function() {
        let p2 = { tag: 'p2' }
        let seen = null
        let semantic = async (ctx) => {
            seen = ctx.page
        }
        await runBaselineCase(baseOpt([], { run: async () => ({ buf: B('x'), page: p2 }), semantic }).opt)
        assert.strict.equal(seen, p2)
    })

    it('未產生任何截圖即拋錯(防比對端空轉假綠); allowEmpty 則放行', async function() {
        await assert.rejects(runBaselineCase(baseOpt([], { mode: 'compare', run: async () => null }).opt), /未產生任何截圖/)
        let r = await runBaselineCase(baseOpt([], { mode: 'compare', run: async () => null, allowEmpty: true }).opt)
        assert.strict.deepStrictEqual(r.shots, [])
    })

    it('stages: 產出之圖鍵與宣告不符即拋錯(一張都不寫); 相符則照常', async function() {
        let { opt, writes } = baseOpt([], { stages: ['E2E-005-1-a', 'E2E-005-3-c'] })
        await assert.rejects(runBaselineCase(opt), /多 \[E2E-005-2-b\] 少 \[E2E-005-3-c\]/)
        assert.strict.equal(writes.length, 0)
        let ok = baseOpt([], { stages: ['E2E-005-2-b', 'E2E-005-1-a'] })
        await runBaselineCase(ok.opt)
        assert.strict.equal(ok.writes.length, 2)
    })

    it('compareOnly: 產製端照常執行與斷言但不寫檔(共用圖不被重寫); 比對端照常比對', async function() {
        let log = []
        let { opt, writes } = baseOpt(log, { compareOnly: true })
        let r = await runBaselineCase(opt)
        assert.strict.equal(r.status, 'compareOnly')
        assert.strict.equal(writes.length, 0)
        assert.strict.ok(log.includes('semantic') && log.includes('verify') && log.includes('b1.close'))
        let c = baseOpt([], { compareOnly: true, mode: 'compare' })
        await runBaselineCase(c.opt)
        assert.strict.equal(c.matches.length, 2)
    })

    it('參數檢查: mode 與必填', async function() {
        await assert.rejects(runBaselineCase({ ...baseOpt([]).opt, mode: 'x' }), /mode/)
        await assert.rejects(runBaselineCase({ ...baseOpt([]).opt, pathOf: null }), /必填/)
    })

})


//部分已知缺陷: run 拋 createKnownDefect 並以 shots 帶出缺陷之前已取得之截圖, 搭配 stages 與 defectStages
//缺陷案例: 4 階段, 前 3 張正常, 第 4 步(E2E-018-4-d)走到缺陷; 測試標題前綴 [A..] 對應 CLAUDE_rulebook.md 表 A
describe('runBaselineCase 部分已知缺陷(createKnownDefect shots + defectStages)', function() {
    let S4 = ['E2E-018-1-a', 'E2E-018-2-b', 'E2E-018-3-c', 'E2E-018-4-d']
    let front3 = () => ({ 'E2E-018-1-a': B('1'), 'E2E-018-2-b': B('2'), 'E2E-018-3-c': B('3') })
    let runPartial = async () => {
        throw createKnownDefect('第4步走到缺陷', { ref: 'spec 已知落差', shots: front3() })
    }
    let runFull = async () => ({ ...front3(), 'E2E-018-4-d': B('4') })
    let runWhole = async () => {
        throw createKnownDefect('整案缺陷')
    }
    let argvOf = (...xs) => ['node', 'x', '--baseline', ...xs]
    let FRONT_KEYS = ['E2E-018-1-a', 'E2E-018-2-b', 'E2E-018-3-c']

    //共用: 假瀏覽器 + 記錄寫檔 / 比對 / 日誌
    function mk(log, over = {}) {
        let writes = []
        let paths = []
        let matches = []
        let logs = []
        return {
            writes,
            paths,
            matches,
            logs,
            opt: {
                mode: 'regen',
                lang: 'eng',
                name: 'E2E-018-x',
                launch: async () => fakeBrowser('b', log),
                run: runPartial,
                stages: S4,
                defectStages: ['E2E-018-4-d'],
                pathOf: (lang, key) => `./test/pics/x/x-${lang}-${key}.png`,
                writeFile: (p, buf) => {
                    paths.push(p)
                    writes.push([path.basename(p, '.png').replace('x-eng-', ''), buf.toString()])
                },
                match: (buf, p, label) => matches.push(label.replace('x-eng-', '')),
                log: (s) => logs.push(s),
                ...over,
            },
        }
    }

    it('[A00] createKnownDefect: 不帶 shots 時錯誤物件無 shots 屬性(與 1.0.8 同); 帶時為同一參考; 非物件即拋', function() {
        let e0 = createKnownDefect('x', { ref: 'r' })
        assert.strict.equal(e0.knownDefect, true)
        assert.strict.equal('shots' in e0, false)
        let s = front3()
        assert.strict.equal(createKnownDefect('x', { shots: s }).shots, s)
        assert.strict.equal('shots' in createKnownDefect('x', { shots: null }), false)
        assert.throws(() => createKnownDefect('x', { shots: 'abc' }), /shots/)
    })

    it('[A01/A02] 未走到缺陷而回傳 4 張: 與現行相同, 4 張全寫 / 全比; stages 檢查不因 defectStages 放寬', async function() {
        let a = mk([], { run: runFull })
        let r = await runBaselineCase(a.opt)
        assert.strict.equal(r.status, 'regen')
        assert.strict.equal(a.writes.length, 4)
        assert.strict.equal('defectStages' in r, false)
        let c = mk([], { run: runFull, mode: 'compare' })
        await runBaselineCase(c.opt)
        assert.strict.equal(c.matches.length, 4)
        await assert.rejects(runBaselineCase(mk([], { run: async () => front3() }).opt), /少 \[E2E-018-4-d\]/)
    })

    it('[A03/A04] 未帶 shots 之 knownDefect(即使給 defectStages): 與 1.0.8 相同, regen 不寫、compare 不比對任何一張', async function() {
        let a = mk([], { run: runWhole })
        let r = await runBaselineCase(a.opt)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.equal(a.writes.length, 0)
        assert.strict.deepStrictEqual(r.shots, [])
        assert.strict.equal('defectStages' in r, false)
        assert.strict.ok(a.logs.some((l) => l.includes('[known-defect]') && l.includes('不寫圖')))
        let got = 0
        let c = mk([], {
            run: runWhole,
            mode: 'compare',
            onKnownDefect: async () => {
                got++
                throw new Error('PENDING')
            },
        })
        await assert.rejects(runBaselineCase(c.opt), /PENDING/)
        assert.strict.equal(c.matches.length, 0)
        assert.strict.equal(got, 1)
    })

    it('[A05] regen: 前 3 張照寫(經 semantic/verify 後), 缺陷步不寫, status 為 knownDefect, 印 [known-defect] 與未產鍵, 仍關瀏覽器', async function() {
        let log = []
        let { opt, writes, logs } = mk(log, { semantic: async () => log.push('semantic'), verify: async () => log.push('verify') })
        let r = await runBaselineCase(opt)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.deepStrictEqual(r.shots, FRONT_KEYS)
        assert.strict.deepStrictEqual(r.written, FRONT_KEYS)
        assert.strict.deepStrictEqual(r.defectStages, ['E2E-018-4-d'])
        assert.strict.deepStrictEqual(writes.map((w) => w[0]), FRONT_KEYS)
        assert.strict.ok(logs.some((l) => l.includes('[known-defect]') && l.includes('前段 3 張') && l.includes('E2E-018-4-d')))
        assert.strict.ok(log.indexOf('semantic') < log.indexOf('verify') && log.indexOf('verify') < log.indexOf('b.close'))
    })

    it('[A06] compare: 前 3 張一致才呼叫 onKnownDefect(其後仍拋出)', async function() {
        let got = null
        let { opt, matches } = mk([], {
            mode: 'compare',
            onKnownDefect: async (e) => {
                got = e
                throw new Error('PENDING')
            },
        })
        await assert.rejects(runBaselineCase(opt), /PENDING/)
        assert.strict.deepStrictEqual(matches, FRONT_KEYS)
        assert.strict.equal(got.knownDefect, true)
        //未給 onKnownDefect: 前段通過後原樣拋出已知缺陷
        await assert.rejects(runBaselineCase(mk([], { mode: 'compare' }).opt), /已知缺陷/)
    })

    it('[A07/A08] compare: 前段任一張不符或缺檔 → 拋比對錯誤, 不呼叫 onKnownDefect(不以 pending 掩蓋前段回歸); compareAll 彙總', async function() {
        let called = 0
        let onKnownDefect = async () => {
            called++
        }
        let match = (buf, p, label) => {
            if (label.endsWith('2-b')) {
                throw new Error(`mismatch ${label}`)
            }
        }
        await assert.rejects(runBaselineCase(mk([], { mode: 'compare', match, onKnownDefect }).opt), /mismatch x-eng-E2E-018-2-b/)
        assert.strict.equal(called, 0)
        await assert.rejects(runBaselineCase(mk([], { mode: 'compare', match, onKnownDefect, compareAll: true }).opt), /共 1\/3 張/)
        assert.strict.equal(called, 0)
        let missing = () => {
            throw new Error('標準圖不存在')
        }
        await assert.rejects(runBaselineCase(mk([], { mode: 'compare', match: missing, onKnownDefect }).opt), /標準圖不存在/)
        assert.strict.equal(called, 0)
    })

    it('[A09-A13] 圖鍵三向核對: 多(拼錯鍵) / 重疊(壞畫面混入) / 少(缺陷早於預期) / 空 shots 未涵蓋前段 → 拋圖鍵不符, 零寫入、不呼叫 onKnownDefect、仍關瀏覽器', async function() {
        let cases = [
            ['多', { ...front3(), 'E2E-018-3-cc': B('x') }, /多 \[E2E-018-3-cc\]/],
            ['重疊', { ...front3(), 'E2E-018-4-d': B('bad') }, /與 defectStages 重疊 \[E2E-018-4-d\]/],
            ['少', { 'E2E-018-1-a': B('1') }, /少 \[E2E-018-2-b, E2E-018-3-c\]/],
            ['空 shots 且 D⊊S', {}, /少 \[E2E-018-1-a, E2E-018-2-b, E2E-018-3-c\]/],
        ]
        for (let [tag, shots, re] of cases) {
            for (let mode of ['regen', 'compare']) {
                let log = []
                let called = 0
                let a = mk(log, {
                    mode,
                    run: async () => {
                        throw createKnownDefect('x', { shots })
                    },
                    onKnownDefect: async () => {
                        called++
                    },
                })
                await assert.rejects(runBaselineCase(a.opt), re, `${tag}/${mode}`)
                assert.strict.equal(a.writes.length, 0, `${tag}/${mode} 不應寫檔`)
                assert.strict.equal(a.matches.length, 0, `${tag}/${mode} 不應比對`)
                assert.strict.equal(called, 0, `${tag}/${mode} 不應呼叫 onKnownDefect`)
                assert.strict.ok(log.includes('b.close'), `${tag}/${mode} 應關瀏覽器`)
            }
        }
    })

    it('[A12] shots 為空且 defectStages 涵蓋全部 stages: 合法, 零寫入', async function() {
        let a = mk([], {
            defectStages: S4,
            run: async () => {
                throw createKnownDefect('x', { shots: {} })
            },
        })
        let r = await runBaselineCase(a.opt)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.equal(a.writes.length, 0)
        //compare 端同(0 張比對後交 onKnownDefect)
        let got = 0
        let c = mk([], {
            mode: 'compare',
            defectStages: S4,
            run: async () => {
                throw createKnownDefect('x', { shots: {} })
            },
            onKnownDefect: async () => {
                got++
                throw new Error('PENDING')
            },
        })
        await assert.rejects(runBaselineCase(c.opt), /PENDING/)
        assert.strict.equal(c.matches.length, 0)
        assert.strict.equal(got, 1)
    })

    it('[A12b] 前段為空而未宣告 stages: 與正常路徑一致須 allowEmpty(防缺陷發生於第一張之前而被歸為 pending 空轉); 已宣告 stages 者由三向核對把關', async function() {
        let emptyShots = async () => {
            throw createKnownDefect('x', { shots: {} })
        }
        for (let mode of ['regen', 'compare']) {
            let a = mk([], { mode, stages: null, defectStages: null, run: emptyShots })
            await assert.rejects(runBaselineCase(a.opt), /未產生任何截圖/, mode)
            assert.strict.equal(a.writes.length, 0)
        }
        let ok = mk([], { stages: null, defectStages: null, run: emptyShots, allowEmpty: true })
        let r = await runBaselineCase(ok.opt)
        assert.strict.equal(r.status, 'knownDefect')
        //已宣告 stages 但 defectStages 未涵蓋全部: 三向核對拋「少」(不是「未產生任何截圖」)
        await assert.rejects(runBaselineCase(mk([], { run: emptyShots }).opt), /少 \[E2E-018-1-a/)
    })

    it('[A14/A15] 帶 shots 但未給 defectStages: stages 已宣告者 shots 須等於 stages(否則拋「少」); stages 未宣告者不核對、前段照常處理; compare 端同規則', async function() {
        let a = mk([], { defectStages: null })
        await assert.rejects(runBaselineCase(a.opt), /少 \[E2E-018-4-d\]/)
        assert.strict.equal(a.writes.length, 0)
        let ac = mk([], { defectStages: null, mode: 'compare' })
        await assert.rejects(runBaselineCase(ac.opt), /少 \[E2E-018-4-d\]/)
        assert.strict.equal(ac.matches.length, 0)
        let cc = mk([], { stages: null, defectStages: null, mode: 'compare' })
        await assert.rejects(runBaselineCase(cc.opt), /已知缺陷/)
        assert.strict.deepStrictEqual(cc.matches, FRONT_KEYS) //前段 3 張照常比對後才原樣拋出
        //shots 恰等於 stages(缺陷於全部截圖之後才偵測到): D 為空亦合法
        let b = mk([], {
            defectStages: null,
            run: async () => {
                throw createKnownDefect('x', { shots: { ...front3(), 'E2E-018-4-d': B('4') } })
            },
        })
        let rb = await runBaselineCase(b.opt)
        assert.strict.equal(rb.status, 'knownDefect')
        assert.strict.equal(b.writes.length, 4)
        //stages 未宣告: 不核對
        let c = mk([], { stages: null, defectStages: null })
        let rc = await runBaselineCase(c.opt)
        assert.strict.equal(rc.status, 'knownDefect')
        assert.strict.deepStrictEqual(rc.written, FRONT_KEYS)
    })

    it('[A16] defectStages 組態錯誤於開瀏覽器前拋出: 無 stages / 含 stages 外之鍵 / 非陣列 / 含空字串', async function() {
        for (let [over, re] of [
            [{ stages: null }, /須與 stages 併用/],
            [{ defectStages: ['E2E-018-9-zz'] }, /不在 stages 內之圖鍵 \[E2E-018-9-zz\]/],
            [{ defectStages: 'E2E-018-4-d' }, /須為圖鍵字串陣列/],
            [{ defectStages: [''] }, /須為圖鍵字串陣列/],
        ]) {
            let launched = 0
            let a = mk([], {
                ...over,
                launch: async () => {
                    launched++
                    return fakeBrowser('b', [])
                },
            })
            await assert.rejects(runBaselineCase(a.opt), re)
            assert.strict.equal(launched, 0)
        }
    })

    it('[A16b] defectStages 空陣列等同未給: 不強制併用 stages, 行為同未給', async function() {
        let launched = 0
        let a = mk([], {
            stages: null,
            defectStages: [],
            launch: async () => {
                launched++
                return fakeBrowser('b', [])
            },
        })
        let r = await runBaselineCase(a.opt)
        assert.strict.equal(launched, 1)
        assert.strict.deepStrictEqual(r.written, FRONT_KEYS)
        //已宣告 stages 時等同 D=∅(A15): shots 須等於 stages
        await assert.rejects(runBaselineCase(mk([], { defectStages: [] }).opt), /少 \[E2E-018-4-d\]/)
    })

    it('[A17] 缺陷路徑仍先過 semantic / verify(ctx.knownDefect 為該錯誤、ctx.shots 為前段); 失敗則一張不寫; 正常路徑無 ctx.knownDefect', async function() {
        let seen = []
        let hook = async (ctx) => seen.push([ctx.knownDefect && ctx.knownDefect.knownDefect, ctx.shots.map((s) => s.key)])
        await runBaselineCase(mk([], { semantic: hook, verify: hook }).opt)
        assert.strict.deepStrictEqual(seen, [[true, FRONT_KEYS], [true, FRONT_KEYS]])
        for (let k of ['semantic', 'verify']) {
            let b = mk([], {
                [k]: async () => {
                    throw new Error(`${k}-fail`)
                },
            })
            await assert.rejects(runBaselineCase(b.opt), new RegExp(`${k}-fail`))
            assert.strict.equal(b.writes.length, 0)
        }
        //compare 端亦先過掛鉤, 失敗則不比對
        let c = mk([], {
            mode: 'compare',
            semantic: async () => {
                throw new Error('semantic-fail')
            },
        })
        await assert.rejects(runBaselineCase(c.opt), /semantic-fail/)
        assert.strict.equal(c.matches.length, 0)
        let flags = []
        await runBaselineCase(mk([], { run: runFull, semantic: async (ctx) => flags.push(ctx.knownDefect) }).opt)
        assert.strict.deepStrictEqual(flags, [undefined])
    })

    it('[A05b] 收尾軸: afterCase 於部分缺陷之成功 / 掛鉤失敗 / 前段不符 / onKnownDefect 拋出 / 圖鍵不符 皆恰執行一次且在關瀏覽器之後', async function() {
        let failWith = (msg) => async () => {
            throw new Error(msg)
        }
        let shortShots = async () => {
            throw createKnownDefect('x', { shots: { 'E2E-018-1-a': B('1') } })
        }
        let scenarios = [
            ['regen 成功', { mode: 'regen' }],
            ['compare 成功(onKnownDefect 拋出)', { mode: 'compare', onKnownDefect: failWith('PENDING') }],
            ['掛鉤失敗', { semantic: failWith('semantic-fail') }],
            ['前段不符', { mode: 'compare', match: failWith('mismatch') }],
            ['圖鍵不符', { run: shortShots }],
        ]
        for (let [tag, over] of scenarios) {
            let log = []
            let a = mk(log, { ...over, afterCase: async () => log.push('afterCase') })
            await runBaselineCase(a.opt).catch(() => {})
            assert.strict.equal(log.filter((l) => l === 'afterCase').length, 1, tag)
            assert.strict.ok(log.indexOf('b.close') >= 0 && log.indexOf('b.close') < log.indexOf('afterCase'), tag)
        }
    })

    it('[A17b] 掛鉤重新指定 ctx.shots: 部分缺陷與正常路徑一致, 寫出 / 比對的是替換後之內容', async function() {
        let replace = async (ctx) => {
            ctx.shots = ctx.shots.map((s) => ({ ...s, buf: B('replaced') }))
        }
        let seen = []
        let a = mk([], { semantic: replace })
        await runBaselineCase(a.opt)
        assert.strict.deepStrictEqual(a.writes.map((w) => w[1]), ['replaced', 'replaced', 'replaced'])
        let n = mk([], { run: runFull, semantic: replace })
        await runBaselineCase(n.opt)
        assert.strict.deepStrictEqual(n.writes.map((w) => w[1]), ['replaced', 'replaced', 'replaced', 'replaced'])
        let c = mk([], {
            mode: 'compare',
            semantic: replace,
            match: (buf) => seen.push(buf.toString()),
            onKnownDefect: async () => {
                throw new Error('PENDING')
            },
        })
        await assert.rejects(runBaselineCase(c.opt), /PENDING/)
        assert.strict.deepStrictEqual(seen, ['replaced', 'replaced', 'replaced'])
    })

    it('[A18] 缺陷路徑中掛鉤又拋不帶 shots 之 knownDefect: 降級為整案缺陷(一張不寫), 與正常路徑一致', async function() {
        let a = mk([], {
            semantic: async () => {
                throw createKnownDefect('另一缺陷')
            },
        })
        let r = await runBaselineCase(a.opt)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.equal(a.writes.length, 0)
        //與正常路徑之掛鉤拋整案缺陷一致: out.shots / ctx.shots 為 run 已取得者(不寫); 部分缺陷專屬之 out.defectStages 與 ctx.knownDefect 移除
        assert.strict.deepStrictEqual(r.shots, FRONT_KEYS)
        assert.strict.equal('defectStages' in r, false)
        let seen = null
        let b = mk([], {
            semantic: async () => {
                throw createKnownDefect('另一缺陷')
            },
            afterCase: async (ctx) => {
                seen = { knownDefect: ctx.knownDefect, shots: ctx.shots.map((s) => s.key) }
            },
        })
        await runBaselineCase(b.opt)
        assert.strict.deepStrictEqual(seen, { knownDefect: undefined, shots: FRONT_KEYS })
        let c = mk([], {
            run: runFull,
            semantic: async () => {
                throw createKnownDefect('正常路徑之掛鉤缺陷')
            },
        })
        let rc = await runBaselineCase(c.opt)
        assert.strict.deepStrictEqual(rc.shots, ['E2E-018-1-a', 'E2E-018-2-b', 'E2E-018-3-c', 'E2E-018-4-d'])
        assert.strict.equal(c.writes.length, 0)
    })

    it('[A18b] 帶 shots 之 knownDefect 若非由 run 拋出(缺陷路徑掛鉤 / 正常路徑掛鉤 / run 之前): 視同一般錯並載明原因, 不被誤當部分缺陷', async function() {
        let throwWithShots = async () => {
            throw createKnownDefect('x', { shots: front3() })
        }
        let cases = [
            ['缺陷路徑掛鉤', { semantic: throwWithShots }, /僅能由 run 拋出[\s\S]*semantic\/verify/],
            ['缺陷路徑 verify', { verify: throwWithShots }, /僅能由 run 拋出[\s\S]*semantic\/verify/],
            ['正常路徑掛鉤', { run: runFull, semantic: throwWithShots }, /僅能由 run 拋出[\s\S]*semantic\/verify/],
            ['run 之前', { beforeRun: throwWithShots }, /僅能由 run 拋出[\s\S]*run 之前/],
        ]
        for (let [tag, over, re] of cases) {
            for (let mode of ['regen', 'compare']) {
                let called = 0
                let a = mk([], {
                    mode,
                    ...over,
                    onKnownDefect: async () => {
                        called++
                    },
                })
                await assert.rejects(runBaselineCase(a.opt), (e) => re.test(e.message) && !e.knownDefect, `${tag}/${mode}`)
                assert.strict.equal(a.writes.length, 0, `${tag}/${mode}`)
                assert.strict.equal(called, 0, `${tag}/${mode}`)
            }
        }
    })

    it('[A19] compareOnly + 部分缺陷: 產製端照跑掛鉤但不寫, skipped=前段', async function() {
        let log = []
        let a = mk(log, { compareOnly: true, semantic: async () => log.push('semantic') })
        let r = await runBaselineCase(a.opt)
        assert.strict.equal(r.status, 'knownDefect')
        assert.strict.equal(a.writes.length, 0)
        assert.strict.deepStrictEqual(r.skipped, FRONT_KEYS)
        assert.strict.ok(log.includes('semantic'))
    })

    it('[A20] run 拋一般錯(非缺陷): 原樣拋出, 不走缺陷分流', async function() {
        let a = mk([], {
            run: async () => {
                throw new Error('boom')
            },
        })
        await assert.rejects(runBaselineCase(a.opt), /boom/)
        assert.strict.equal(a.writes.length, 0)
    })

    it('[A21] regen 配 gate: 只寫 --names 命中之前段, 其餘 skip, 缺陷步不論篩選與否都不寫; finalize 通過', async function() {
        let gate = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-018-x', stages: S4 }], argv: argvOf('--names', 'eng-E2E-018-2-b'), env: {}, log: () => {} })
        let r = await runBaselineCase(mk([], { gate }).opt)
        assert.strict.deepStrictEqual(r.written, ['E2E-018-2-b'])
        assert.strict.deepStrictEqual(r.skipped, ['E2E-018-1-a', 'E2E-018-3-c'])
        gate.finalize()
        //outDir: 前段寫出路徑導至 outDir
        let g2 = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-018-x', stages: S4 }], argv: argvOf(), env: { E2E_BASELINE_OUT_DIR: './test/_tmp/out' }, log: () => {} })
        let b = mk([], { gate: g2 })
        await runBaselineCase(b.opt)
        assert.strict.deepStrictEqual(
            b.paths.map((p) => p.split('\\').join('/')),
            FRONT_KEYS.map((k) => `test/_tmp/out/x-eng-${k}.png`),
        )
    })

    describe('[A21] --write-mode 於缺陷路徑(真檔案, 與正常路徑共用 decideWrite)', function() {
        let dir = path.resolve('./test/_tmp/runBaselineCase-defect')
        let png = (v) => {
            let p = new PNG({ width: 20, height: 20 })
            p.data.fill(v)
            for (let i = 3; i < p.data.length; i += 4) {
                p.data[i] = 255
            }
            return PNG.sync.write(p)
        }
        let pathOf = (lang, key) => path.join(dir, `x-${lang}-${key}.png`)
        beforeEach(function() {
            fs.rmSync(dir, { recursive: true, force: true })
            fs.mkdirSync(dir, { recursive: true })
        })
        after(function() {
            fs.rmSync(dir, { recursive: true, force: true })
            let parent = path.dirname(dir)
            if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
                fs.rmdirSync(parent)
            }
        })

        it('missing: 前段已存在者 keep、缺者寫出', async function() {
            fs.writeFileSync(pathOf('eng', 'E2E-018-1-a'), 'x')
            let gate = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-018-x', stages: S4 }], argv: argvOf('--write-mode', 'missing'), env: {}, log: () => {} })
            let a = mk([], { gate, pathOf, writeFile: (p, buf) => fs.writeFileSync(p, buf) })
            let r = await runBaselineCase(a.opt)
            assert.strict.deepStrictEqual(r.kept, ['E2E-018-1-a'])
            assert.strict.deepStrictEqual(r.written, ['E2E-018-2-b', 'E2E-018-3-c'])
            assert.strict.equal(fs.existsSync(pathOf('eng', 'E2E-018-4-d')), false)
        })

        it('changed: 差異在容差內者 keep, 超過者寫出', async function() {
            for (let k of FRONT_KEYS) {
                fs.writeFileSync(pathOf('eng', k), png(100))
            }
            let shots = { 'E2E-018-1-a': png(100), 'E2E-018-2-b': png(0), 'E2E-018-3-c': png(100) } //2-b 全異(400px > 100)
            let gate = createBaselineGate({ langs: ['eng'], cases: [{ name: 'E2E-018-x', stages: S4 }], argv: argvOf('--write-mode', 'changed'), env: {}, log: () => {} })
            let a = mk([], {
                gate,
                pathOf,
                writeFile: (p, buf) => fs.writeFileSync(p, buf),
                run: async () => {
                    throw createKnownDefect('x', { shots })
                },
            })
            let r = await runBaselineCase(a.opt)
            assert.strict.deepStrictEqual(r.kept, ['E2E-018-1-a', 'E2E-018-3-c'])
            assert.strict.deepStrictEqual(r.written, ['E2E-018-2-b'])
        })
    })

    it('[A22] shots 格式同 run 之回傳: 物件 / 陣列[{name|key,buf}] / 單一 Buffer(鍵=案例名) / {shots,page} 皆可; 元素非 Buffer 由 normalizeShots 拋', async function() {
        let arr = [{ name: 'E2E-018-1-a', buf: B('1') }, { key: 'E2E-018-2-b', buf: B('2') }, { name: 'E2E-018-3-c', buf: B('3') }]
        for (let shots of [front3(), arr, { shots: arr, page: {} }]) {
            let a = mk([], {
                run: async () => {
                    throw createKnownDefect('x', { shots })
                },
            })
            let r = await runBaselineCase(a.opt)
            assert.strict.deepStrictEqual(r.written, FRONT_KEYS)
        }
        //{shots,page} 換頁: 與正常路徑一致, 其後之 semantic / verify / afterCase 收到新 page
        let newPage = { tag: 'new-page' }
        for (let withDefect of [false, true]) {
            let seenPages = []
            let hook = async (ctx) => seenPages.push(ctx.page.tag || 'old-page')
            let a = mk([], {
                semantic: hook,
                verify: hook,
                afterCase: hook,
                run: async () => {
                    let shots = { shots: withDefect ? front3() : { ...front3(), 'E2E-018-4-d': B('4') }, page: newPage }
                    if (withDefect) {
                        throw createKnownDefect('x', { shots })
                    }
                    return shots
                },
            })
            await runBaselineCase(a.opt)
            assert.strict.deepStrictEqual(seenPages, ['new-page', 'new-page', 'new-page'], withDefect ? '部分缺陷' : '正常路徑')
        }
        //單一 Buffer: 圖鍵為案例名
        let s2 = ['E2E-018-x', 'E2E-018-4-d']
        let one = mk([], {
            stages: s2,
            run: async () => {
                throw createKnownDefect('x', { shots: B('1') })
            },
        })
        let r1 = await runBaselineCase(one.opt)
        assert.strict.deepStrictEqual(r1.written, ['E2E-018-x'])
        let bad = mk([], {
            run: async () => {
                throw createKnownDefect('x', { shots: { 'E2E-018-1-a': 'not-a-buffer' } })
            },
        })
        await assert.rejects(runBaselineCase(bad.opt), /不是 Buffer/)
        assert.strict.equal(bad.writes.length, 0)
    })
})
