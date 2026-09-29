/**
 * 把案例執行函數之各種回傳形狀正規化為截圖陣列[{key,buf}]
 *
 * 支援：①Buffer(單張，圖鍵為name)；②物件{圖鍵:Buffer}(多階段)；③陣列[{name,buf}]或[{key,buf}]；
 * ④包裝物件{buf,page}或{shots,page}(執行中換頁者，page另由呼叫端取用)；⑤null或undefined(無截圖)。
 * 圖鍵重複、元素不是Buffer一律拋錯
 *
 * @param {*} result 輸入案例執行函數之回傳值
 * @param {String} name 輸入案例鍵字串(單張時作為圖鍵)
 * @returns {Array} 回傳截圖陣列[{key,buf}]
 * @example
 *
 * import normalizeShots from 'w-package-tools-e2e/src/normalizeShots.mjs'
 *
 * normalizeShots(buf, 'E2E-001-list-loaded')
 * // => [{ key: 'E2E-001-list-loaded', buf }]
 * normalizeShots({ 'E2E-002-1-a': b1, 'E2E-002-2-b': b2 }, 'E2E-002-x')
 * // => [{ key: 'E2E-002-1-a', buf: b1 }, { key: 'E2E-002-2-b', buf: b2 }]
 *
 */
function normalizeShots(result, name) {
    let out = []
    if (result === null || result === undefined) {
        return out
    }
    if (Buffer.isBuffer(result)) {
        out = [{ key: name, buf: result }]
    }
    else if (Array.isArray(result)) {
        out = result.map((x, i) => {
            let key = x && (x.name !== undefined ? x.name : x.key)
            if (!key) {
                throw new Error(`normalizeShots: ${name} 第 ${i} 張缺 name/key`)
            }
            return { key: String(key), buf: x.buf }
        })
    }
    else if (typeof result === 'object' && ('buf' in result || 'shots' in result)) {
        return normalizeShots('shots' in result ? result.shots : result.buf, name)
    }
    else if (typeof result === 'object') {
        out = Object.entries(result).map(([key, buf]) => ({ key, buf }))
    }
    else {
        throw new Error(`normalizeShots: ${name} 之回傳型別不支援 (${typeof result})`)
    }
    let keys = new Set()
    for (let s of out) {
        if (!Buffer.isBuffer(s.buf)) {
            throw new Error(`normalizeShots: ${name} 之 ${s.key} 不是 Buffer`)
        }
        if (keys.has(s.key)) {
            throw new Error(`normalizeShots: ${name} 之圖鍵重複 ${s.key}`)
        }
        keys.add(s.key)
    }
    return out
}


export default normalizeShots
