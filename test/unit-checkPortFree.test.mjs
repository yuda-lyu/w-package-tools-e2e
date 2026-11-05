import assert from 'assert'
import net from 'net'
import checkPortFree, { waitPortsFree } from '../src/checkPortFree.mjs'


//checkPortFree 之試綁定順序、第 5 種(ipv6Only 之 ::)與無 IPv6 之處置(pe316)。
//以替身取代 net.createServer(不碰真實埠; 真實占用者見 api-checkPortFree): 依 listen 收到之 { host, ipv6Only } 決定回應。
//規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E1、E4; 帳本 sgud/rule/rulebook_port.md R-26。


let origCreate = net.createServer
let calls = []


//decide(o) 回 null 為綁定成功, 否則為錯誤碼
function install(decide) {
    calls = []
    net.createServer = () => {
        let handlers = {}
        let srv = {
            once: (ev, fn) => {
                handlers[ev] = fn
                return srv
            },
            listen: (o, cb) => {
                calls.push({ port: o.port, host: o.host, ipv6Only: o.ipv6Only, exclusive: o.exclusive })
                let code = decide(o)
                setImmediate(() => (code === null ? cb() : handlers.error(Object.assign(new Error(code), { code }))))
                return srv
            },
            close: (cb) => {
                if (cb) {
                    cb()
                }
                return srv
            },
        }
        return srv
    }
}


let hostsOf = () => calls.map((c) => (c.ipv6Only === true ? `${c.host}(ipv6Only)` : c.host))


describe('checkPortFree', function() {

    afterEach(function() {
        net.createServer = origCreate
    })

    after(function() {
        assert.strict.equal(net.createServer, origCreate, '替身須還原')
    })

    //對應「沒有占用時之埠與行為不變」: 回傳形狀與前四種試綁定之選項不變, 僅多第 5 種
    it('[CU1] 無占用: 依序試 127.0.0.1、0.0.0.0、::(雙棧)、::1、::(ipv6Only), 回可用; 前四種不帶 ipv6Only', async function() {
        install(() => null)
        let r = await checkPortFree(19961)
        assert.strict.deepEqual(r, { port: 19961, free: true, host: '', code: '' })
        assert.strict.deepEqual(hostsOf(), ['127.0.0.1', '0.0.0.0', '::', '::1', '::(ipv6Only)'])
        assert.strict.deepEqual(calls.slice(0, 4).map((c) => c.ipv6Only), [undefined, undefined, undefined, undefined], '前四種與舊版同形(不帶 ipv6Only)')
        assert.strict.deepEqual(calls.map((c) => [c.port, c.exclusive]), Array(5).fill([19961, true]))
        assert.strict.deepEqual(Object.keys(r), ['port', 'free', 'host', 'code'])
    })

    //對應「ipv6Only 之 :: 占用者要被偵測」
    it('[CU2] 只有第 5 種(ipv6Only 之 ::)衝突: 回不可用, host 標明 ipv6Only, code 為 EADDRINUSE', async function() {
        install((o) => (o.host === '::' && o.ipv6Only === true ? 'EADDRINUSE' : null))
        let r = await checkPortFree(19962)
        assert.strict.deepEqual(r, { port: 19962, free: false, host: '::(ipv6Only)', code: 'EADDRINUSE' })
        assert.strict.equal(calls.length, 5)
    })

    it('[CU3] 雙棧 :: 衝突(第 3 種): 回 host=::, 不再試第 4、5 種; 127.0.0.1 衝突: 只試 1 次', async function() {
        install((o) => (o.host === '::' && o.ipv6Only !== true ? 'EADDRINUSE' : null))
        assert.strict.deepEqual(await checkPortFree(19963), { port: 19963, free: false, host: '::', code: 'EADDRINUSE' })
        assert.strict.deepEqual(hostsOf(), ['127.0.0.1', '0.0.0.0', '::'])
        install((o) => (o.host === '127.0.0.1' ? 'EADDRINUSE' : null))
        assert.strict.deepEqual(await checkPortFree(19963), { port: 19963, free: false, host: '127.0.0.1', code: 'EADDRINUSE' })
        assert.strict.deepEqual(hostsOf(), ['127.0.0.1'])
    })

    //對應「本機無 IPv6 者不算占用」(含第 5 種)
    it('[CU4] 本機無 IPv6(含第 5 種皆 EAFNOSUPPORT 或 EADDRNOTAVAIL): 不算占用, 回可用', async function() {
        install((o) => (o.host.includes(':') ? 'EAFNOSUPPORT' : null))
        assert.strict.deepEqual(await checkPortFree(19964), { port: 19964, free: true, host: '', code: '' })
        assert.strict.equal(calls.length, 5)
        install((o) => (o.host.includes(':') ? 'EADDRNOTAVAIL' : null))
        assert.strict.deepEqual(await checkPortFree(19964), { port: 19964, free: true, host: '', code: '' })
        //只有第 5 種回 EADDRNOTAVAIL, 前四種綁定成功
        install((o) => (o.ipv6Only === true ? 'EADDRNOTAVAIL' : null))
        assert.strict.equal((await checkPortFree(19964)).free, true)
    })

    it('[CU5] 其他錯誤碼: 第 5 種回 EACCES 算不可用(host 標 ipv6Only); IPv4 位址之 EADDRNOTAVAIL 不略過', async function() {
        install((o) => (o.ipv6Only === true ? 'EACCES' : null))
        assert.strict.deepEqual(await checkPortFree(19965), { port: 19965, free: false, host: '::(ipv6Only)', code: 'EACCES' })
        install((o) => (o.host === '0.0.0.0' ? 'EADDRNOTAVAIL' : null))
        assert.strict.deepEqual(await checkPortFree(19965), { port: 19965, free: false, host: '0.0.0.0', code: 'EADDRNOTAVAIL' })
    })

    it('[CU6] 錯誤物件無 code: 以 ERROR 計為不可用(舊行為不變); 第 5 種亦同', async function() {
        install((o) => (o.ipv6Only === true ? '' : null))
        let r = await checkPortFree(19966)
        assert.strict.deepEqual(r, { port: 19966, free: false, host: '::(ipv6Only)', code: 'ERROR' })
    })

    it('[CU7] waitPortsFree: 第 5 種持續衝突時逾時回傳該埠, 衝突消失即回空陣列', async function() {
        let n = 0
        install((o) => {
            if (o.ipv6Only === true) {
                n++
                return n <= 2 ? 'EADDRINUSE' : null
            }
            return null
        })
        assert.strict.deepEqual(await waitPortsFree([19967], 5000), [])
        install((o) => (o.ipv6Only === true ? 'EADDRINUSE' : null))
        assert.strict.deepEqual(await waitPortsFree([19967], 100), [{ port: 19967, free: false, host: '::(ipv6Only)', code: 'EADDRINUSE' }])
    })
})
