import assert from 'assert'
import pageHasText from './pageHasText.mjs'
import collectDomText from './collectDomText.mjs'


/**
 * 以spec衍生之期望文字斷言頁面：mode為'text'時頁面須含value，'absentText'時頁面不得含value；不符即拋出斷言錯誤並附頁面文字供診斷
 *
 * 期望文字應自spec與語系檔衍生(可觀察之訊息原文)，不可取自現狀；像素比對只是補強層，每案仍須先有此類語意斷言
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} spec 輸入期望物件{mode,value}，mode為'text'或'absentText'
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.label=''] 輸入錯誤訊息用之案例標籤字串，預設''
 * @returns {Promise} 回傳Promise，符合時resolve，不符時reject斷言錯誤
 * @example
 *
 * import assertTextSpec from 'w-package-tools-e2e/src/assertTextSpec.mjs'
 *
 * await assertTextSpec(page, { mode: 'text', value: 'Save tokens successfully' }, { label: 'E2E-002' })
 *
 */
async function assertTextSpec(page, spec, opt = {}) {
    let { label = '' } = opt
    if (!spec || (spec.mode !== 'text' && spec.mode !== 'absentText')) {
        throw new Error(`assertTextSpec: spec.mode 須為 text 或 absentText${label ? ` (${label})` : ''}`)
    }
    let has = await pageHasText(page, spec.value)
    if (spec.mode === 'text' && !has) {
        let dump = await collectDomText(page)
        assert.fail(`預期含 "${spec.value}" (${label}), 實際: ${dump}`)
    }
    if (spec.mode === 'absentText' && has) {
        let dump = await collectDomText(page)
        assert.fail(`預期不含 "${spec.value}" (${label}), 但見到. 可見文字: ${dump}`)
    }
}


export default assertTextSpec
