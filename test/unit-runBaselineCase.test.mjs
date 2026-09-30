import assert from 'assert'
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
