import assert from 'assert'
import stepShots from '../src/stepShots.mjs'


//stepShots 之單元測試: 以注入之假 capture 驗呼叫順序(前圖 → 操作 → 就緒 → 後圖)、兼任(before:null)、後圖目標延後取得、必填檢查


describe('stepShots', function() {

    let mkLog = () => {
        let log = []
        let capture = async (page, target, opt) => {
            log.push(`capture:${target}${opt && opt.tag ? `:${opt.tag}` : ''}`)
            return Buffer.from(`img-${target}`)
        }
        return { log, capture }
    }

    it('依序: 框操作目標 → 操作 → 等反應 → 框反應; 回傳兩張; opt 透傳 capture', async function() {
        let { log, capture } = mkLog()
        let r = await stepShots('page', {
            capture,
            before: '#save',
            act: async () => {
                log.push('act')
            },
            ready: async () => {
                log.push('ready')
            },
            after: '#modal',
            beforeOpt: { tag: 'b' },
            afterOpt: { tag: 'a' },
        })
        assert.strict.deepStrictEqual(log, ['capture:#save:b', 'act', 'ready', 'capture:#modal:a'])
        assert.strict.deepStrictEqual([r.before.toString(), r.after.toString()], ['img-#save', 'img-#modal'])
    })

    it('兼任: before:null 不拍前圖(由前一步之後圖兼任, 技能 §7.3-1)', async function() {
        let { log, capture } = mkLog()
        let r = await stepShots('page', {
            capture,
            before: null,
            act: async () => {
                log.push('act')
            },
            after: '#list'
        })
        assert.strict.deepStrictEqual(log, ['act', 'capture:#list'])
        assert.strict.equal(r.before, null)
    })

    it('後圖目標為函數時於就緒後才取得(目標於操作後才出現)', async function() {
        let { log, capture } = mkLog()
        let appeared = false
        await stepShots('page', {
            capture,
            before: '#btn',
            act: async () => {
                appeared = true
            },
            after: async () => {
                assert.strict.equal(appeared, true)
                return '#appeared'
            },
        })
        assert.strict.deepStrictEqual(log, ['capture:#btn', 'capture:#appeared'])
    })

    it('必填: before 省略(undefined)、after 省略、capture / act 非函數即拋錯; 操作拋錯時不拍後圖', async function() {
        let { log, capture } = mkLog()
        await assert.rejects(() => stepShots('page', { capture, act: async () => {}, after: '#x' }), /before 不可省略/)
        await assert.rejects(() => stepShots('page', { capture, before: '#b', act: async () => {} }), /after 為必填/)
        await assert.rejects(() => stepShots('page', { before: '#b', act: async () => {}, after: '#x' }), /capture 須為函數/)
        await assert.rejects(() => stepShots('page', { capture, before: '#b', after: '#x' }), /act 須為函數/)
        log.length = 0
        await assert.rejects(() => stepShots('page', {
            capture,
            before: '#b',
            act: async () => {
                throw new Error('click failed')
            },
            after: '#x'
        }), /click failed/)
        assert.strict.deepStrictEqual(log, ['capture:#b'])
    })

})
