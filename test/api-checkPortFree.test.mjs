import fs from 'fs'
import path from 'path'
import assert from 'assert'
import checkPortFree from '../src/checkPortFree.mjs'
import reserveE2ePorts from '../src/reserveE2ePorts.mjs'
import { spawnOccupant, assertOccupantIntact, stopChild } from './tools/portOccupant.mjs'


//試綁定偵測五種占用形式之實機測試(pe316): 真實監聽行程與真實占用者, 占用者 PID 不變、仍回應。
//規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E1、E4、E5; 帳本 sgud/rule/rulebook_port.md R-26。
//背景: Windows 下每種位址只和同一形式之占用者衝突; ipv6Only 之 :: 與雙棧 :: 是兩種形式, 只試雙棧 :: 偵測不到 ipv6Only 者(pe312 實測)。
//固定埠(不隨機; 避開其他測試之 19200～19500、19620～19640、19650 起、19711～19716、19800、19801、19901): 19960 起, 每案遞增; 位移 100 後為 20060 起。


let fdRoot = path.resolve('test/_tmp/apiCheckPortFree')
let regDir = path.join(fdRoot, 'reg')
let portNext = 19960
let spawned = []
let handles = []

//五種占用形式: host 為占用者綁定之位址, ipv6Only 為占用者是否 ipv6Only, want 為 checkPortFree 回傳之 host
let KINDS = [
    { label: '127.0.0.1', host: '127.0.0.1', ipv6Only: false, want: '127.0.0.1' },
    { label: '0.0.0.0', host: '0.0.0.0', ipv6Only: false, want: '0.0.0.0' },
    { label: '::(雙棧)', host: '::', ipv6Only: false, want: '::' },
    { label: '::1', host: '::1', ipv6Only: false, want: '::1' },
    { label: '::(ipv6Only)', host: '::', ipv6Only: true, want: '::(ipv6Only)' },
]


function nextPort() {
    return portNext++
}


//占用者: 自建之獨立行程, 真實監聽; 本機無 IPv6 時 IPv6 形式無法綁定, 該案略過
async function occupy(ctx, k, port) {
    try {
        return await spawnOccupant(port, k.host, spawned, { ipv6Only: k.ipv6Only })
    }
    catch (err) {
        if (k.host.includes(':')) {
            return ctx.skip()
        }
        throw err
    }
}


function reserve(port, logs) {
    let h = reserveE2ePorts([port], { applyEnv: false, regDir, env: {}, log: (s) => logs.push(String(s)) })
    handles.push(h)
    return h
}


describe('試綁定五種占用形式(實機)', function() {

    this.timeout(90000)

    before(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        fs.mkdirSync(regDir, { recursive: true })
    })

    afterEach(function() {
        handles.splice(0).forEach((h) => h.release())
        spawned.splice(0).forEach(stopChild)
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    })

    for (let k of KINDS) {
        //對應「被占用就回不可用、寫明哪種位址與錯誤碼; 不動占用者」
        it(`[CF1] checkPortFree: 占用者綁 ${k.label}: 回不可用(host=${k.want}, EADDRINUSE), 占用者 PID 不變且仍回應`, async function() {
            let port = nextPort()
            let o = await occupy(this, k, port)
            let r = await checkPortFree(port)
            assert.strict.deepEqual(r, { port, free: false, host: k.want, code: 'EADDRINUSE' })
            await assertOccupantIntact(o)
        })

        //對應「被占用就換埠(整組位移 100), 占用者毫髮無傷, 訊息寫明誰占用」
        it(`[CF2] reserveE2ePorts: 基準埠被占用者綁 ${k.label}: 換到位移 100, 占用者 PID 不變且仍回應, 訊息寫明占用者`, async function() {
            let port = nextPort()
            let o = await occupy(this, k, port)
            let logs = []
            let h = reserve(port, logs)
            assert.strict.deepEqual([h.offset, h.ports, h.shifted], [100, [port + 100], true], logs.join('\n'))
            await assertOccupantIntact(o)
            let text = logs.join('\n')
            assert.strict.ok(text.includes(`略過 埠 ${port}`) && text.includes(`EADDRINUSE@${k.want}`), text)
            assert.strict.ok(text.includes(`PID ${o.child.pid}`), `訊息須寫明占用者: ${text}`)
            //只持有新一組之預約, 被占用的那組已撤回
            assert.strict.deepEqual(fs.readdirSync(regDir), [`p${port + 100}.json`])
            //新一組之埠可綁定(沒有被占用者連帶占走)
            assert.strict.deepEqual(await checkPortFree(port + 100), { port: port + 100, free: true, host: '', code: '' })
        })
    }

    //對應「沒有占用時之埠與行為不變」
    it('[CF3] 無占用: checkPortFree 回可用; reserveE2ePorts 取得基準埠、不移位', async function() {
        let port = nextPort()
        assert.strict.deepEqual(await checkPortFree(port), { port, free: true, host: '', code: '' })
        let logs = []
        let h = reserve(port, logs)
        assert.strict.deepEqual([h.offset, h.ports, h.shifted], [0, [port], false], logs.join('\n'))
        assert.strict.ok(!logs.join('\n').includes('略過'), logs.join('\n'))
    })

    //對應「占用者結束後不殘留誤判」(ipv6Only 占用者結束後, 同一埠回可用, 且 reserveE2ePorts 回到基準埠)
    it('[CF4] ipv6Only 占用者結束後: 同一埠回可用, reserveE2ePorts 回到基準埠', async function() {
        let port = nextPort()
        let k = KINDS[4]
        let o = await occupy(this, k, port)
        assert.strict.equal((await checkPortFree(port)).free, false)
        stopChild(o.child)
        let t0 = Date.now()
        while (o.child.exitCode === null && o.child.signalCode === null && Date.now() - t0 < 15000) {
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert.strict.deepEqual(await checkPortFree(port), { port, free: true, host: '', code: '' })
        let logs = []
        let h = reserve(port, logs)
        assert.strict.deepEqual([h.offset, h.ports], [0, [port]], logs.join('\n'))
    })

    //對應「兩種形式同時存在: 依序偵測到第一個, 兩者皆不動」
    it('[CF5] 同埠同時有 127.0.0.1 與 ipv6Only :: 兩個占用者: 回不可用, 兩者皆毫髮無傷; 換埠後不碰兩者', async function() {
        let port = nextPort()
        let a = await occupy(this, KINDS[0], port)
        let b = await occupy(this, KINDS[4], port)
        let r = await checkPortFree(port)
        assert.strict.equal(r.free, false)
        assert.strict.equal(r.host, '127.0.0.1')
        let logs = []
        let h = reserve(port, logs)
        assert.strict.deepEqual(h.ports, [port + 100], logs.join('\n'))
        await assertOccupantIntact(a)
        await assertOccupantIntact(b)
    })
})
