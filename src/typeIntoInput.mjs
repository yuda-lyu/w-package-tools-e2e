/**
 * 以真人鍵盤輸入文字至輸入框(Pattern D)，供Vue v-model等受控輸入框
 *
 * 流程：等可見 → 等1000ms(元件掛載與綁定穩定) → 點擊 → 驗證焦點確實落在該元素(防父層mousedown.prevent攔截造成靜默漏字)
 * → 以End加Backspace逐字清空(不用Ctrl+A或剪貼簿，避免與系統快捷鍵衝突) → keyboard.insertText一次注入 → 驗證值，不符重試至多3次。
 * why insertText：逐字type於受控輸入框每字觸發重繪，焦點可能中途離開而漏字
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Locator} locator 輸入輸入框之Locator
 * @param {String} value 輸入要填入之文字字串
 * @returns {Promise} 回傳Promise，resolve代表值已正確填入，3次仍不符則reject
 * @example
 *
 * import typeIntoInput from 'w-package-tools-e2e/src/typeIntoInput.mjs'
 *
 * await typeIntoInput(page, page.locator('input[type="password"]').first(), 'Pw@login1')
 *
 */
async function typeIntoInput(page, locator, value) {
    await locator.waitFor({ state: 'visible', timeout: 5000 })
    //編輯器掛載/焦點轉移/v-model綁定穩定之緩衝
    await page.waitForTimeout(1000)

    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await locator.click()
        //驗證焦點落在該輸入框
        let handle = await locator.elementHandle()
        await page.waitForFunction((el) => document.activeElement === el, handle, { timeout: 3000 })
        //清空既有值
        let cur = await locator.inputValue()
        if (cur) {
            await page.keyboard.press('End')
            for (let k = 0; k < cur.length + 2; k++) await page.keyboard.press('Backspace')
        }
        //一次注入
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        let got = await locator.inputValue()
        if (got === value) return
        console.warn(`typeIntoInput attempt ${attempt}/${maxAttempts}: 預期「${value}」實得「${got}」, 重試`)
        await page.waitForTimeout(400)
    }
    let final = await locator.inputValue()
    throw new Error(`typeIntoInput ${maxAttempts} 次仍漏字: 預期「${value}」(${value.length} 字), 最終「${final}」(${(final || '').length} 字)`)
}


export default typeIntoInput
