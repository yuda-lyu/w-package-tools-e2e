/**
 * 解析`netstat -ano`之輸出，取出本地位址為指定port之TCP監聽列之PID(字串、去重)
 *
 * 監聽列之判定：外部位址為0.0.0.0:0、[::]:0或*:*(監聽中之socket沒有對端)，或狀態欄為LISTENING；前者與顯示語言無關(部分語系之Windows會在地化狀態字)。
 * 以「本地位址結尾為:port」比對，避開外部位址含:port之連線列；IPv6位址含zone id亦適用；UDP列與表頭(在地化文字)皆略過。
 * 移植自w-web-task test/tools/harnessProc.mjs(含其單元測試)
 *
 * @param {String} text 輸入netstat -ano之輸出字串
 * @param {Number} port 輸入port
 * @returns {Array} 回傳PID字串陣列，無監聽者回傳[]
 * @example
 *
 * import parseListenerPids from 'w-package-tools-e2e/src/parseListenerPids.mjs'
 *
 * parseListenerPids('  TCP    0.0.0.0:11007   0.0.0.0:0   LISTENING   1234', 11007)
 * // => ['1234']
 *
 */
function parseListenerPids(text, port) {
    let pids = new Set()
    for (let line of String(text || '').split(/\r?\n/)) {
        let cols = line.trim().split(/\s+/)
        if (cols.length < 5) continue
        let [proto, local, foreign, state, pid] = cols
        if (!/^TCP/i.test(proto)) continue
        let listening = foreign === '0.0.0.0:0' || foreign === '[::]:0' || foreign === '*:*' || state === 'LISTENING'
        if (!listening) continue
        if (!local.endsWith(`:${port}`)) continue
        if (/^\d+$/.test(pid)) pids.add(pid)
    }
    return [...pids]
}


export default parseListenerPids
