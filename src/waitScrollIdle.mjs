/**
 * 等頁面上進行中之捲動(平滑捲動動畫、JS逐格捲動)結束：連續quietFrames個動畫影格內任何元素(含文件本身)皆無scroll事件即視為靜止；本函數不拋錯
 *
 * why(排程第 504 項，2026-11-24)：captureStableWithBox 於量框前以 Playwright 之 scrollIntoViewIfNeeded 把目標捲入，
 * 其底層為 CDP DOM.scrollIntoViewIfNeeded(瞬間捲動)；平滑捲動進行中呼叫時，進行中之動畫被截斷於中途
 * (使用端實測：scrollTop 停在 254 而非動畫終點 267，標準圖差約 13px 位移)，即使目標本已完整可見(被截斷者可為目標之外之捲動容器)。
 * 先等捲動靜止再呼叫，動畫跑完、終點確定；無捲動進行時只多等 quietFrames 個影格(約 50ms)，畫面不變。
 * 偵測：document 之 capture 階段監聽 scroll(元素之 scroll 事件不冒泡，但 capture 階段可收到)；scroll 事件於影格更新時、rAF 之前派發，
 * 有捲動之影格即歸零重數。頁面隱藏(背景分頁，rAF 停擺)而 250ms 內一個影格都沒有時視為靜止(無影格即無捲動動畫進行)；
 * 頁面可見而影格晚到(高負載)時照常等，由硬逾時兜底(不懸置)。
 * 逾時(仍持續捲動，例如跑馬燈)回傳 idle:false，由呼叫端決定(captureStableWithBox 印告警後續行)。
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeout=3000] 輸入等待上限毫秒數，預設3000
 * @param {Number} [opt.quietFrames=3] 輸入連續無捲動之影格數，預設3
 * @returns {Promise} 回傳Promise，resolve回傳{idle,scrolls,frames,waitedMs}，idle為是否已靜止，scrolls為等待期間之scroll事件數，frames為經過之影格數
 * @example
 *
 * import waitScrollIdle from 'w-package-tools-e2e/src/waitScrollIdle.mjs'
 *
 * await page.locator('#btn').click() //觸發 el.scrollIntoView({ behavior: 'smooth' })
 * let r = await waitScrollIdle(page)
 * //r.idle===true 時捲動已結束
 *
 */
async function waitScrollIdle(page, opt = {}) {
    let { timeout = 3000, quietFrames = 3 } = opt
    if (!(typeof timeout === 'number' && timeout >= 0 && Number.isFinite(timeout))) {
        timeout = 3000
    }
    if (!(Number.isInteger(quietFrames) && quietFrames >= 1)) {
        quietFrames = 3
    }
    return await page.evaluate(({ timeoutMs, quietN }) => new Promise((resolve) => {
        let t0 = performance.now()
        let quiet = 0
        let frames = 0
        let scrolls = 0
        let ended = false
        let hHard = null
        let hNoFrame = null
        let onScroll = () => {
            scrolls++
            quiet = -1 //本影格有捲動: 其後之 rAF 會把它加回 0
        }
        let finish = (idle) => {
            if (ended) {
                return
            }
            ended = true
            clearTimeout(hHard)
            clearTimeout(hNoFrame)
            document.removeEventListener('scroll', onScroll, { capture: true })
            resolve({ idle, scrolls, frames, waitedMs: Math.round(performance.now() - t0) })
        }
        document.addEventListener('scroll', onScroll, { capture: true, passive: true })
        let tick = () => {
            if (ended) {
                return
            }
            frames++
            quiet++
            if (quiet >= quietN) {
                finish(true)
                return
            }
            if (performance.now() - t0 >= timeoutMs) {
                finish(false)
                return
            }
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        hHard = setTimeout(() => finish(false), timeoutMs)
        //rAF 停擺只發生於頁面隱藏(背景分頁)時: 此時亦無捲動動畫在進行, 判靜止; 頁面可見而影格晚到(高負載)時照常等, 由硬逾時兜底
        hNoFrame = setTimeout(() => {
            if (frames === 0 && document.hidden) {
                finish(scrolls === 0)
            }
        }, Math.min(250, timeoutMs))
    }), { timeoutMs: timeout, quietN: quietFrames })
}


export default waitScrollIdle
