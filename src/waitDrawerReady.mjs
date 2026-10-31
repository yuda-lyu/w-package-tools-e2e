import isenum from 'wsemi/src/isenum.mjs'


/**
 * 【w-component-vue】等WDrawer抽屜到達穩定態(opened或hidden)才放行
 *
 * 讀WDrawer根節點之[state]屬性(平移transitionend決定性標記hidden/opening/opened/hiding)，所有抽屜皆為opened或hidden即放行；
 * 事件驅動，不受主執行緒負載影響(取代易被減速尾段騙而截到半途之座標取樣)。頁面無WDrawer時立即放行；逾時(預設10000ms)不拋錯，交由呼叫端之連拍穩定兜底
 *
 * 只認WDrawer根節點，不認其他帶state之元件：w-component-vue 2.5.35起WDialog(根節點)、WTooltip／WPopup／WTextSelect等之浮層(.WPopperFix)、
 * WGroupDragdrop、WGroupTags、WListExpandItem(根節點)亦帶state屬性，其中WDialog與浮層之值域(hidden／opening／opened)與WDrawer重疊，
 * 若以裸[state]選取會等到它們，或把無抽屜之頁面誤判為有抽屜。
 * 辨識依據(w-component-vue 2.5.35實際渲染之DOM，探測於2026-11-01)：WDrawer根節點無固定class，
 * 帶有其獨有之changedrawerwidth屬性(WDrawer.vue:5之:changeDrawerWidth綁定，2022-04起；上列其他元件之根節點皆無，WDialog為changeparam、WListExpandItem為changeactive)，
 * 故預設選擇器為[state][changedrawerwidth]；該屬性屬元件內部實作，元件改版致其消失時預設選擇器會選不到抽屜(此時視為無WDrawer而立即放行)，可改傳opt.selector
 *
 * opt為選填，給了就檢測，非預期之輸入一律視為未給、改用預設，不拋錯(dspec〈輸入參數之檢測機制〉K3)：
 * opt本身為undefined、null或非一般物件(陣列、類別實例、Date、數字、字串等)時整份視為{}；各鍵為undefined或null視為未給；
 * opt.timeout須為正數或正數字串(有效數字，去頭尾空白)且不超過2147483647，轉換後才使用，否則用10000(0在Playwright代表不逾時，會永遠等下去，故不收)；
 * opt.selector須為非空白字串且可被瀏覽器解析為CSS選擇器，否則用預設選擇器；
 * 未宣告之鍵忽略(本函數不轉傳opt)。
 * opt.debug為true時(非布林視為false)另輸出警告，說明哪個鍵因非預期已改用預設；警告出口為opt.funLog(函數，以(msg, { fn, reason, key })呼叫)，未給則console.warn；
 * 警告為固定詞彙，只含函數名、鍵名、種類描述與所採之預設，不含傳入之值與頁面內容；同一鍵、同一原因每個行程只警告一次；出口拋錯一律忽略
 *
 * @param {Page} page 輸入Playwright之Page
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number|String} [opt.timeout=10000] 輸入逾時毫秒數，須為大於0且不超過2147483647之有效數字(數字或數字字串)，非預期者改用預設，預設10000
 * @param {String} [opt.selector='[state][changedrawerwidth]'] 輸入抽屜根節點之CSS選擇器字串，預設'[state][changedrawerwidth]'。
 *     用於預設選擇器失效或需改認他種元件時(例如傳'[state]'即為w-component-vue 2.5.35前之行為)，會取代預設而非疊加；
 *     命中元素之state仍須為hidden／opening／opened／hiding才計入；非字串、空白字串、無法解析之選擇器改用預設
 * @param {Boolean} [opt.debug=false] 輸入是否於opt出現非預期輸入時輸出警告布林值，非布林視為false，預設false
 * @param {Function} [opt.funLog=null] 輸入警告出口函數，以(msg, { fn, reason, key })呼叫，未給則用console.warn，預設null
 * @returns {Promise} 回傳Promise，resolve代表已穩定或已逾時
 * @example
 *
 * import waitDrawerReady from 'w-package-tools-e2e/src/waitDrawerReady.mjs'
 *
 * await waitDrawerReady(page)
 *
 * @example
 *
 * import waitDrawerReady from 'w-package-tools-e2e/src/waitDrawerReady.mjs'
 *
 * await waitDrawerReady(page, { selector: '#myDrawer[state]', timeout: 5000 })
 *
 */
async function waitDrawerReady(page, opt = {}) {
    let { timeout, selector, debug, funLog, probs } = parseOpt(opt)

    //自訂選擇器須可被瀏覽器解析, 否則改用預設; 頁面不可用時(如已關閉)視為可解析, 交由下方等待照原樣吞掉
    if (selector !== SELECTOR_DEF) {
        let ok = await page.evaluate((s) => {
            try {
                document.querySelector(s)
                return true
            }
            catch (err) {
                return false
            }
        }, selector).catch(() => true)
        if (!ok) {
            probs.push(['selector-syntax', 'selector'])
            selector = SELECTOR_DEF
        }
    }

    if (debug && probs.length > 0) {
        emit(probs, funLog)
    }

    await page.waitForFunction((sel) => {
        let drawerStates = Array.from(document.querySelectorAll(sel))
            .map((e) => e.getAttribute('state'))
            .filter((s) => ['hidden', 'opening', 'opened', 'hiding'].includes(s))
        if (drawerStates.length === 0) {
            return true //無WDrawer, 放行
        }
        //所有抽屜須為穩定態, 不可停在opening/hiding過渡中
        return drawerStates.every((s) => s === 'opened' || s === 'hidden')
    }, selector, { timeout, polling: 100 }).catch(() => {})
}


let SELECTOR_DEF = '[state][changedrawerwidth]'
let TIMEOUT_DEF = 10000
let TIMEOUT_MAX = 2147483647 //Node計時器上限, 與wsemi之TIMER_TIME_MAX相同
let KEYS = new Set(['timeout', 'selector', 'debug', 'funLog'])
let IDENT = /^[A-Za-z_$][\w$]{0,31}$/ //警告可帶入之鍵名(短識別字), 避免回顯任意長字串


//是否為一般物件: 原型為null, 或原型之原型為null且原型自有isPrototypeOf(即任一領域之Object.prototype), 不含陣列、類別實例、包裝物件、Date
function isPlainObj(o) {
    if (typeof o !== 'object' || o === null) {
        return false
    }
    try {
        if (Object.prototype.toString.call(o) !== '[object Object]') {
            return false
        }
        let p = Object.getPrototypeOf(o)
        if (p === null) {
            return true
        }
        return Object.getPrototypeOf(p) === null && Object.prototype.hasOwnProperty.call(p, 'isPrototypeOf')
    }
    catch (err) {
        return false
    }
}


//解析opt(K3): 非預期之輸入視為未給改用預設, 每個鍵只讀一次, 不改寫呼叫端之opt; probs為[原因, 鍵名]之清單, 僅debug時輸出
function parseOpt(opt) {
    let timeout = TIMEOUT_DEF
    let selector = SELECTOR_DEF
    let debug = false
    let funLog = null
    let probs = []

    //opt本身須為一般物件, 否則整份視為{}(此時讀不到debug, 故不警告)
    let keys = null
    if (isPlainObj(opt)) {
        try {
            keys = Object.keys(opt)
        }
        catch (err) {
            keys = null
        }
    }
    if (keys === null) {
        return { timeout, selector, debug, funLog, probs }
    }

    for (let k of keys) {

        //未宣告之鍵忽略(本函數不轉傳opt, 故debug時提示)
        if (!KEYS.has(k)) {
            probs.push(['unknown', IDENT.test(k) ? k : ''])
            continue
        }

        //讀取一次, 讀取拋錯(存取器)視為該鍵無效
        let v
        try {
            v = opt[k]
        }
        catch (err) {
            if (k === 'timeout' || k === 'selector') {
                probs.push(['read', k])
            }
            continue
        }

        //undefined與null視為未給
        if (v === undefined || v === null) {
            continue
        }

        if (k === 'debug') {
            debug = v === true //非布林視為false
        }
        else if (k === 'funLog') {
            funLog = typeof v === 'function' ? v : null
        }
        else if (k === 'timeout') {
            if (isenum(v, { gt: 0, max: TIMEOUT_MAX })) {
                timeout = Number(v) //檢測之值即使用之值(K4), 數字字串轉為數字
            }
            else {
                probs.push(['timeout', 'timeout'])
            }
        }
        else if (typeof v === 'string' && v.trim() !== '') { //selector
            selector = v
        }
        else {
            probs.push(['selector', 'selector'])
        }
    }

    return { timeout, selector, debug, funLog, probs }
}


//警告訊息(固定詞彙, 不含傳入之值)
function getMsg(reason, key) {
    let s = '[w-package-tools-e2e waitDrawerReady] '
    if (reason === 'unknown') {
        return key !== '' ? `${s}invalid opt.${key}: unknown option, ignored` : `${s}invalid opt: unknown option, ignored`
    }
    if (reason === 'read') {
        return `${s}invalid opt.${key}: cannot be read, using default ${key === 'timeout' ? TIMEOUT_DEF : `'${SELECTOR_DEF}'`}`
    }
    if (reason === 'timeout') {
        return `${s}invalid opt.timeout: must be a positive number up to ${TIMEOUT_MAX}, using default ${TIMEOUT_DEF}`
    }
    if (reason === 'selector-syntax') {
        return `${s}invalid opt.selector: must be a valid CSS selector, using default '${SELECTOR_DEF}'`
    }
    return `${s}invalid opt.selector: must be a non-empty string, using default '${SELECTOR_DEF}'` //selector
}


//已警告之表(每個行程), 有上限避免呼叫端以大量不同鍵名撐大
let WARNED_MAX = 256
let warned = new Set()


//輸出警告: 有funLog者交funLog(msg, info), 否則console.warn(msg); 同一原因與鍵每個行程只警告一次; 出口拋錯一律忽略
function emit(probs, funLog) {
    for (let [reason, key] of probs) {
        let id = `${reason}|${key}`
        if (warned.has(id)) {
            continue
        }
        if (warned.size >= WARNED_MAX) {
            return
        }
        warned.add(id)
        let msg = getMsg(reason, key)
        try {
            if (funLog !== null) {
                funLog(msg, { fn: 'waitDrawerReady', reason, key })
            }
            else {
                console.warn(msg)
            }
        }
        catch (err) {
            //忽略
        }
    }
}


//重設已警告之表(供測試, 不屬對外介面)
waitDrawerReady.resetWarned = () => {
    warned.clear()
}


export default waitDrawerReady
