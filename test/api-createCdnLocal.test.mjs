import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import { sha, waitUntil, deferred, makeFixture, startServer, spawnChild } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md R-CL-2、R-CL-3(跨行程只下載一次、持鎖行程被強制結束後之接手、離線)
//  真實多行程: 以 test/tools/cdnAcquireChild.mjs 起子行程, 對夾具伺服器(本機)取得; 以事件(子行程印出之 onTrace 事件)與可觀察條件同步, 不以延時

let fdTmp = fileURLToPath(new URL('./_tmp/api-createCdnLocal/', import.meta.url))
let n = 0
let dirOf = (name) => {
    let d = path.join(fdTmp, `${name}-${++n}`)
    fs.mkdirSync(d, { recursive: true })
    return d
}
let writeManifest = (dir, manifest) => {
    let fp = path.join(dir, 'manifest.json')
    fs.writeFileSync(fp, JSON.stringify(manifest))
    return fp
}


describe('api-createCdnLocal', function() {
    this.timeout(120000)

    let fx = makeFixture(6)

    before(function() {
        fs.mkdirSync(fdTmp, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('[CA01] 4 個行程同時首次取得: 只有 1 個取鎖下載, 其餘 3 個等候後直接採用, 每檔對伺服器只請求 1 次; 子行程自行結束(心跳不阻擋結束)', async function() {
        let gate = deferred()
        let srv = await startServer(fx.bodies, gate)
        let kids = []
        try {
            let dir = dirOf('multi')
            let mfp = writeManifest(dir, fx.manifest)
            let cache = path.join(dir, 'cache')
            kids = Array.from({ length: 4 }, () => spawnChild(mfp, cache, srv.baseUrl))
            let ev = () => kids.flatMap((k) => k.events)

            //事件同步: 持鎖者已對伺服器發出請求(被 gate 擋住), 且其餘 3 個行程皆已觀察到鎖被占用, 才放行
            //  等候上限須小於下載之停滯上限 30 秒(持鎖者被 gate 擋住之請求逾 30 秒會被判停滯而重試, 使請求次數失真)
            await waitUntil(() => ev().filter((e) => e.type === 'lock-wait').length === 3 && Object.keys(srv.hits).length >= 1, 25000, '3 個等候者與 1 個持鎖者就位')
            assert.strictEqual(ev().filter((e) => e.type === 'lock-acquired').length, 1, '應只有 1 個行程取鎖')
            gate.resolve()
            let rs = await Promise.all(kids.map((k) => k.done))
            for (let r of rs) {
                assert.strictEqual(r.code, 0, '子行程失敗: ' + r.out + r.err)
            }
            assert.strictEqual(ev().filter((e) => e.type === 'ready').length, 4, '4 個行程皆應就緒')
            assert.strictEqual(ev().filter((e) => e.type === 'downloaded').length, 6, '全體只下載 6 檔(每檔 1 次)')
            assert.strictEqual(new Set(ev().filter((e) => e.type === 'downloaded').map((e) => e.pid)).size, 1, '全部由同一個行程下載')
            for (let p of Object.keys(fx.bodies)) {
                assert.strictEqual(srv.hits[p], 1, p + ' 應只被請求 1 次')
            }
            let journal = fs.readFileSync(path.join(cache, 'downloads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
            assert.strictEqual(new Set(journal.map((j) => j.url)).size, 6)
            assert.strictEqual(journal.length, 6, '下載紀錄每檔恰 1 列')
            for (let [url, e] of Object.entries(fx.manifest.files)) {
                assert.strictEqual(sha(fs.readFileSync(path.join(cache, e.sha256))), e.sha256, url + ' 校驗')
            }
            assert.ok(!fs.existsSync(path.join(cache, '.lock')), '鎖應已釋放')
            assert.deepStrictEqual(fs.readdirSync(cache).filter((f) => /\.part$|\.stale-/.test(f)), [], '不應殘留暫存檔或墓碑')
        }
        finally {
            gate.resolve()
            for (let k of kids) {
                k.kill() //失敗時不遺留子行程
            }
            await srv.close()
        }
    })

    it('[CA02] 持鎖行程被強制結束(未釋放鎖): 另一行程判定殘留並接手完成取得, 全體每檔仍只成功下載一次', async function() {
        let gate = deferred()
        let srv = await startServer(fx.bodies, gate)
        let k1 = null
        let k2 = null
        try {
            let dir = dirOf('crash')
            let mfp = writeManifest(dir, fx.manifest)
            let cache = path.join(dir, 'cache')
            k1 = spawnChild(mfp, cache, srv.baseUrl)
            await waitUntil(() => k1.events.some((e) => e.type === 'lock-acquired') && Object.keys(srv.hits).length >= 1, 25000, '持鎖行程取鎖並已對伺服器發出請求(被 gate 擋住)')
            let lockDir = path.join(cache, '.lock')
            assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')))
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).pid, k1.pid)
            k1.kill() //強制結束: 不執行任何清理, 鎖與其 owner.json 殘留
            await k1.done
            assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')), '被強制結束之行程未釋放鎖')
            gate.resolve()
            k2 = spawnChild(mfp, cache, srv.baseUrl)
            let r = await k2.done
            assert.strictEqual(r.code, 0, '接手行程失敗: ' + r.out + r.err)
            let types = k2.events.map((e) => e.type)
            assert.ok(types.includes('lock-stale-judged') && types.includes('lock-stale-reclaimed') && types.includes('lock-acquired'), '事件: ' + types.filter((t) => t !== 'lock-poll'))
            assert.ok(types.indexOf('lock-stale-reclaimed') < types.indexOf('lock-acquired'))
            assert.strictEqual(k2.events.filter((e) => e.type === 'downloaded').length, 6)
            let journal = fs.readFileSync(path.join(cache, 'downloads.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
            assert.strictEqual(journal.length, 6, '成功下載每檔恰 1 次(被強制結束者一檔也未完成)')
            assert.ok(!fs.existsSync(lockDir))
            for (let [url, e] of Object.entries(fx.manifest.files)) {
                assert.strictEqual(sha(fs.readFileSync(path.join(cache, e.sha256))), e.sha256, url)
            }
        }
        finally {
            gate.resolve()
            for (let k of [k1, k2]) {
                if (k) {
                    k.kill()
                }
            }
            await srv.close()
        }
    })

    it('[CA03] 持鎖行程仍在: 等候行程不誤判為殘留(不回收), 於持鎖者完成後採用其成果(跨行程之心跳)', async function() {
        let gate = deferred()
        let srv = await startServer(fx.bodies, gate)
        let k1 = null
        let k2 = null
        try {
            let dir = dirOf('alive')
            let mfp = writeManifest(dir, fx.manifest)
            let cache = path.join(dir, 'cache')
            let fast = JSON.stringify({ staleMs: 1500 }) //殘留判定時長 1.5 秒: 持鎖者之心跳(每 0.5 秒)須使其不被判殘留
            k1 = spawnChild(mfp, cache, srv.baseUrl, [fast])
            await waitUntil(() => k1.events.some((e) => e.type === 'lock-acquired') && Object.keys(srv.hits).length >= 1, 25000, '持鎖行程取鎖並已對伺服器發出請求')
            k2 = spawnChild(mfp, cache, srv.baseUrl, [fast])
            let t0 = Date.now()
            await waitUntil(() => k2.events.filter((e) => e.type === 'lock-poll').length >= 10 && Date.now() - t0 > 1500 * 3, 25000, '等候者已輪詢 10 輪且持鎖逾殘留判定時長之 3 倍')
            assert.ok(!k2.events.some((e) => e.type === 'lock-stale-judged'), '持鎖者行程存在且有心跳, 不得被判殘留')
            gate.resolve()
            let rs = await Promise.all([k1.done, k2.done])
            for (let r of rs) {
                assert.strictEqual(r.code, 0, r.out + r.err)
            }
            assert.ok(!k2.events.some((e) => e.type === 'downloaded'), '等候者不下載')
            for (let p of Object.keys(fx.bodies)) {
                assert.strictEqual(srv.hits[p], 1, p + ' 應只被請求 1 次')
            }
        }
        finally {
            gate.resolve()
            for (let k of [k1, k2]) {
                if (k) {
                    k.kill()
                }
            }
            await srv.close()
        }
    })

    it('[CA04] 離線(跨行程): 缺檔時子行程以 E_CDN_OFFLINE_MISSING 失敗且不連網; 另一行程備妥後, 離線行程照常就緒', async function() {
        let srv = await startServer(fx.bodies)
        try {
            let dir = dirOf('offline')
            let mfp = writeManifest(dir, fx.manifest)
            let cache = path.join(dir, 'cache')
            let off = JSON.stringify({ offline: true })
            let k1 = spawnChild(mfp, cache, srv.baseUrl, [off])
            let r1 = await k1.done
            assert.strictEqual(r1.code, 1)
            assert.ok(/ERR E_CDN_OFFLINE_MISSING/.test(r1.out), r1.out)
            assert.deepStrictEqual(srv.hits, {}, '離線不得連網')
            let r2 = await spawnChild(mfp, cache, srv.baseUrl).done
            assert.strictEqual(r2.code, 0, r2.out + r2.err)
            let k3 = spawnChild(mfp, cache, srv.baseUrl, [off])
            let r3 = await k3.done
            assert.strictEqual(r3.code, 0, r3.out + r3.err)
            assert.deepStrictEqual(k3.events.map((e) => e.type), ['ready'], '備妥時只有 ready, 不取鎖')
            for (let p of Object.keys(fx.bodies)) {
                assert.strictEqual(srv.hits[p], 1)
            }
        }
        finally {
            await srv.close()
        }
    })

})
