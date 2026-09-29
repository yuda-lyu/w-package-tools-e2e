/**
 * 探測HTTP服務是否有回應(用於「port已有服務則沿用、否則啟動」之判斷)
 *
 * 預設只要有任何HTTP回應即為true(連線失敗或逾時為false)；opt.accept可限制狀態碼(例如status<500)；
 * opt.identify可讀回應內文判斷是否為本專案之服務(契約C2：health回專案識別才沿用，避免沿用到他專案之服務)
 *
 * @param {String} url 輸入網址字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.timeoutMs=1500] 輸入逾時毫秒數，預設1500
 * @param {Function} [opt.accept] 輸入狀態碼判斷函數(status)=>Boolean，預設全部接受
 * @param {Function} [opt.identify] 輸入內文判斷函數(text)=>Boolean，預設不讀內文
 * @param {Function} [opt.fetchFn=fetch] 輸入fetch函數(供測試注入)，預設全域fetch
 * @returns {Promise} 回傳Promise，resolve回傳是否有(符合條件之)回應
 * @example
 *
 * import probeHttp from 'w-package-tools-e2e/src/probeHttp.mjs'
 *
 * let up = await probeHttp('http://127.0.0.1:11007/')
 *
 */
async function probeHttp(url, opt = {}) {
    let { timeoutMs = 1500, accept = () => true, identify = null, fetchFn = fetch } = opt
    let ctrl = new AbortController()
    let timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        let res = await fetchFn(url, { signal: ctrl.signal })
        if (!accept(res.status)) {
            return false
        }
        if (typeof identify === 'function') {
            let text = await res.text()
            return !!identify(text)
        }
        return true
    }
    catch (err) {
        return false
    }
    finally {
        clearTimeout(timer)
    }
}


export default probeHttp
