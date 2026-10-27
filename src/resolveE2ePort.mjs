/**
 * 依環境變數E2E_PORT_OFFSET把基準埠位移為本實例之實際埠(多開臨時實例用)
 *
 * 實際埠＝基準埠＋位移；位移未設、空字串或為0時原樣回傳基準埠(不驗證、不轉型，與未支援位移前逐位元一致)。
 * 位移須為非負整數字串，位移後之埠須為1～65535之整數，否則拋錯(不靜默沿用基準埠：沿用即會連到他實例之服務)。
 * 專案端只宣告基準埠：服務以createServiceManager之services[].port宣告(其內部已套用位移，spawn收到之port即實際埠)，
 * 前端網址、設定檔內之埠、killPortListeners之對象等其餘組埠處一律經本函數取實際埠。probeHttp收完整網址，不另位移
 *
 * @param {Number} basePort 輸入基準埠
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} [opt.env=process.env] 輸入環境變數物件，預設process.env
 * @param {String} [opt.offsetEnv='E2E_PORT_OFFSET'] 輸入位移之環境變數名稱字串，預設'E2E_PORT_OFFSET'
 * @returns {Number} 回傳實際埠
 * @example
 *
 * import resolveE2ePort from 'w-package-tools-e2e/src/resolveE2ePort.mjs'
 *
 * //E2E_PORT_OFFSET=100 時
 * let baseUrl = `http://127.0.0.1:${resolveE2ePort(8080)}` //http://127.0.0.1:8180
 *
 */
function resolveE2ePort(basePort, opt = {}) {
    let { env = process.env, offsetEnv = 'E2E_PORT_OFFSET' } = opt
    let raw = env[offsetEnv]
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return basePort
    }
    let s = String(raw).trim()
    if (!/^\d+$/.test(s)) {
        throw new Error(`${offsetEnv} 須為非負整數，實得「${raw}」`)
    }
    let offset = Number(s)
    if (offset === 0) {
        return basePort
    }
    let base = Number(basePort)
    if (!Number.isInteger(base) || base < 1 || base > 65535) {
        throw new Error(`resolveE2ePort: 基準埠須為 1～65535 之整數，實得「${basePort}」`)
    }
    let port = base + offset
    if (port > 65535) {
        throw new Error(`resolveE2ePort: 基準埠 ${base} 加 ${offsetEnv}=${offset} 為 ${port}，超過 65535`)
    }
    return port
}


export default resolveE2ePort
