import net from 'net'


let BIND_HOSTS = ['127.0.0.1', '0.0.0.0', '::', '::1']


let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//試綁定一個埠一次: 回 null 為成功, 否則回錯誤碼
function tryBind(port, host) {
    return new Promise((resolve) => {
        let s = net.createServer()
        s.once('error', (err) => resolve(err.code || 'ERROR'))
        s.listen({ port, host, exclusive: true }, () => {
            s.close(() => resolve(null))
        })
    })
}


/**
 * 以實際綁定檢查埠是否可用：逐一試127.0.0.1、0.0.0.0、::、::1，綁定後立即釋放
 *
 * Windows下特定位址與萬用位址可並存，只試一種會漏掉占用者；本機無IPv6者不算占用。
 *
 * @param {Number} port 輸入埠
 * @returns {Promise} 回傳Promise，resolve回傳物件{port,free,host,code}，free為是否可用，不可用時host為失敗之位址、code為錯誤碼
 * @example
 *
 * import checkPortFree from 'w-package-tools-e2e/src/checkPortFree.mjs'
 *
 * console.log(await checkPortFree(8080))
 * // => { port: 8080, free: true, host: '', code: '' }
 *
 */
async function checkPortFree(port) {
    for (let host of BIND_HOSTS) {
        let code = await tryBind(port, host)
        if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
            if (host.includes(':')) {
                continue
            }
        }
        if (code !== null) {
            return { port, free: false, host, code }
        }
    }
    return { port, free: true, host: '', code: '' }
}


/**
 * 等多個埠皆可綁定，回傳逾時後仍不可綁定者
 *
 * @param {Array} ports 輸入埠陣列
 * @param {Number} timeoutMs 輸入等待上限毫秒數
 * @returns {Promise} 回傳Promise，resolve回傳陣列，元素同checkPortFree之回傳，皆可綁定時為空陣列
 * @example
 *
 * import { waitPortsFree } from 'w-package-tools-e2e/src/checkPortFree.mjs'
 *
 * console.log(await waitPortsFree([8080, 11007], 5000))
 * // => []
 *
 */
export async function waitPortsFree(ports, timeoutMs) {
    let remain = ports
    let start = Date.now()
    while (true) {
        let rs = await Promise.all(remain.map((p) => checkPortFree(p)))
        let busy = rs.filter((r) => !r.free)
        if (busy.length === 0 || Date.now() - start >= timeoutMs) {
            return busy
        }
        remain = busy.map((r) => r.port)
        await sleep(300)
    }
}


export default checkPortFree
