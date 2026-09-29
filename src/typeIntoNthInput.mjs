/**
 * 以真人鍵盤輸入文字至頁面第idx個input(Pattern D，與typeIntoInput同機制)，供無穩定選擇器之表單
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Number} idx 輸入input之索引(document.querySelectorAll('input')之順序)
 * @param {String} value 輸入要填入之文字字串
 * @returns {Promise} 回傳Promise，resolve代表值已正確填入，3次仍不符則reject
 * @example
 *
 * import typeIntoNthInput from 'w-package-tools-e2e/src/typeIntoNthInput.mjs'
 *
 * await typeIntoNthInput(page, 2, '10.0.0.9')
 *
 */
async function typeIntoNthInput(page, idx, value) {
    let inp = page.locator('input').nth(idx)
    await inp.waitFor({ state: 'visible', timeout: 5000 })

    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await inp.click()
        await page.waitForFunction((i) => {
            let inputs = document.querySelectorAll('input')
            return document.activeElement === inputs[i]
        }, idx, { timeout: 3000 })
        //清空(End加Backspace逐字, 不用剪貼簿或Ctrl+A)
        let cur = await page.evaluate((i) => document.querySelectorAll('input')[i]?.value || '', idx)
        if (cur) {
            await page.keyboard.press('End')
            for (let k = 0; k < cur.length + 2; k++) await page.keyboard.press('Backspace')
        }
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        let got = await page.evaluate((i) => {
            let el = document.querySelectorAll('input')[i]
            return el ? el.value : null
        }, idx)
        if (got === value) return
        console.warn(`typeIntoNthInput attempt ${attempt}/${maxAttempts}: 預期「${value}」實得「${got}」, 重試`)
        await page.waitForTimeout(400)
    }

    let final = await page.evaluate((i) => document.querySelectorAll('input')[i]?.value, idx)
    throw new Error(`typeIntoNthInput ${maxAttempts} 次仍漏字: 預期「${value}」(${value.length} 字), 最終「${final}」(${(final || '').length} 字)`)
}


export default typeIntoNthInput
