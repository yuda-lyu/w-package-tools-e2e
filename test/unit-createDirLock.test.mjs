import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import createDirLock from '../src/createDirLock.mjs'
import { waitUntil, deadPid } from './tools/cdnLocalFixture.mjs'


//規則帳本 sgud/rule/rulebook_cdn.md R-CL-3、R-CL-4(跨行程資料夾鎖: 互斥、殘留判定、原子回收、心跳、釋放核對 token)
//  原語層之測試: 兩個 createDirLock 實例對同一資料夾，依指定順序呼叫原語，確定性地重現回收之交錯(不依賴延時)

let fdTmp = fileURLToPath(new URL('./_tmp/createDirLock/', import.meta.url))
let n = 0
let dirOf = () => {
    let fd = path.join(fdTmp, `c${++n}`)
    fs.mkdirSync(fd, { recursive: true })
    return path.join(fd, '.lock')
}
let readOwner = (lockDir) => JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
let setMtime = (fp, msAgo) => {
    let d = new Date(Date.now() - msAgo)
    fs.utimesSync(fp, d, d)
}


describe('unit-createDirLock', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('[DL01] 互斥: 同一資料夾只有一個實例取得鎖; owner.json 記本行程之 pid 與 token; 釋放後可再取得', function() {
        let lockDir = dirOf()
        let a = createDirLock({ lockDir })
        let b = createDirLock({ lockDir })
        assert.strictEqual(a.tryLock(), true)
        assert.strictEqual(b.tryLock(), false, '已被占用者不得再取得')
        let o = readOwner(lockDir)
        assert.strictEqual(o.pid, process.pid)
        assert.ok(/^[0-9a-f]{16}$/.test(o.token))
        a.release()
        assert.strictEqual(fs.existsSync(lockDir), false, '釋放後鎖資料夾應消失')
        assert.strictEqual(b.tryLock(), true)
        b.release()
    })

    it('[DL02] 釋放核對 token: 被他人接手後, 原持有者釋放不得刪除他人之新鎖', function() {
        let lockDir = dirOf()
        let a = createDirLock({ lockDir })
        let b = createDirLock({ lockDir, isAlive: () => false }) //A 之持有者行程在 B 眼中視為已死
        assert.strictEqual(a.tryLock(), true)
        let judged = b.judge()
        assert.ok(judged, 'A 之持有者行程被判不存在, 應判殘留')
        assert.strictEqual(b.reclaim(judged), true)
        assert.strictEqual(b.tryLock(), true)
        let tokB = readOwner(lockDir).token
        a.release()
        assert.ok(fs.existsSync(lockDir), 'B 之新鎖不得被 A 之釋放刪除')
        assert.strictEqual(readOwner(lockDir).token, tokB)
        b.release()
        assert.strictEqual(fs.existsSync(lockDir), false)
    })

    it('[DL03] judge: 行程存在且心跳新鮮 → null; 行程不存在 → 殘留(帶判定當下之 token); 心跳逾 staleMs → 殘留', function() {
        let lockDir = dirOf()
        let a = createDirLock({ lockDir })
        assert.strictEqual(a.tryLock(), true)
        let tok = readOwner(lockDir).token
        assert.strictEqual(createDirLock({ lockDir }).judge(), null, '持有者存活且心跳新鮮不得判殘留')
        let seen = []
        let dead = createDirLock({
            lockDir,
            isAlive: (pid) => {
                seen.push(pid)
                return false
            },
        })
        assert.deepStrictEqual(dead.judge(), { token: tok })
        assert.deepStrictEqual(seen, [process.pid], 'isAlive 應收到 owner.json 之 pid')
        a.release() //停止心跳
        let lockDir2 = dirOf()
        fs.mkdirSync(lockDir2)
        fs.writeFileSync(path.join(lockDir2, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'old', t: 0 }))
        let stale = createDirLock({ lockDir: lockDir2, staleMs: 1000 })
        assert.strictEqual(stale.judge(), null, '心跳新鮮')
        setMtime(path.join(lockDir2, 'owner.json'), 5000)
        assert.deepStrictEqual(stale.judge(), { token: 'old' }, '心跳逾 staleMs')
    })

    it('[DL04] judge: owner.json 尚未寫入或無法解析時改以鎖資料夾之修改時間判定(不取其中之 pid); 鎖不存在回 null', function() {
        let lockDir = dirOf()
        assert.strictEqual(createDirLock({ lockDir }).judge(), null, '鎖不存在')
        fs.mkdirSync(lockDir)
        let j = createDirLock({ lockDir, staleMs: 1000, isAlive: () => false })
        assert.strictEqual(j.judge(), null, '剛建立而 owner 尚未寫入: 不得判殘留(即使 isAlive 回 false)')
        setMtime(lockDir, 5000)
        assert.deepStrictEqual(j.judge(), { token: '' }, '無 owner 檔而鎖資料夾已逾 staleMs')
        fs.writeFileSync(path.join(lockDir, 'owner.json'), '{"pid":12') //寫到一半
        setMtime(lockDir, 0)
        setMtime(path.join(lockDir, 'owner.json'), 0)
        assert.strictEqual(j.judge(), null, 'owner 無法解析且新鮮: 不得判殘留')
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 'abc', token: 7 }))
        assert.strictEqual(j.judge(), null, 'pid 非正整數視為無 pid, 只依時間: 新鮮不判殘留')
        setMtime(path.join(lockDir, 'owner.json'), 5000)
        assert.deepStrictEqual(j.judge(), { token: '' }, 'token 非字串視為空字串')
    })

    it('[DL04b] judge: owner.json 在而暫時讀不到(無法解析)時, 以 owner.json 之修改時間(心跳)判定, 不退回鎖資料夾之修改時間——長時間持有之活鎖(資料夾修改時間早已逾 staleMs)不得被誤判為殘留', function() {
        let lockDir = dirOf()
        fs.mkdirSync(lockDir)
        let fp = path.join(lockDir, 'owner.json')
        fs.writeFileSync(fp, '{"pid":') //暫時讀不到之形狀(寫到一半)
        setMtime(lockDir, 600000) //鎖資料夾建立已久
        setMtime(fp, 0) //但心跳新鮮
        let j = createDirLock({ lockDir, staleMs: 1000, isAlive: () => false })
        assert.strictEqual(j.judge(), null, '心跳新鮮之活鎖不得判殘留')
        setMtime(fp, 5000)
        assert.deepStrictEqual(j.judge(), { token: '' }, '心跳逾 staleMs 才判殘留')
    })

    it('[DL05] reclaim: 判定之 token 相符 → 回收成功, 鎖與墓碑資料夾皆消失; 鎖不存在 → false', function() {
        let lockDir = dirOf()
        let b = createDirLock({ lockDir, isAlive: () => false })
        assert.strictEqual(b.reclaim({ token: 'x' }), false, '鎖不存在')
        fs.mkdirSync(lockDir)
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 1, token: 'dead' }))
        let judged = b.judge()
        assert.deepStrictEqual(judged, { token: 'dead' })
        assert.strictEqual(b.reclaim(judged), true)
        assert.strictEqual(fs.existsSync(lockDir), false)
        assert.deepStrictEqual(fs.readdirSync(path.dirname(lockDir)), [], '不得遺留墓碑資料夾')
    })

    it('[DL06] 兩個回收者交錯: 先回收者建立新鎖後, 後到者依舊判定回收, 不得刪除該新鎖(搬走後核對 token 並改回)', function() {
        let lockDir = dirOf()
        fs.mkdirSync(lockDir)
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 1, token: 'dead' }))
        let a = createDirLock({ lockDir, isAlive: () => false })
        let b = createDirLock({ lockDir, isAlive: () => false })
        let ja = a.judge()
        let jb = b.judge()
        assert.deepStrictEqual([ja, jb], [{ token: 'dead' }, { token: 'dead' }], '兩者皆已判定同一把殘留鎖')
        assert.strictEqual(a.reclaim(ja), true)
        assert.strictEqual(a.tryLock(), true, 'A 回收後取得新鎖')
        let tokA = readOwner(lockDir).token
        assert.strictEqual(b.reclaim(jb), false, 'B 依舊判定回收: 搬到的是 A 之新鎖, 核對不符須改回而非刪除')
        assert.ok(fs.existsSync(lockDir), 'A 之新鎖應仍在')
        assert.strictEqual(readOwner(lockDir).token, tokA, '改回後 owner 為 A')
        assert.deepStrictEqual(fs.readdirSync(path.dirname(lockDir)), ['.lock'], '不得遺留墓碑資料夾')
        a.release()
    })

    it('[DL07] 心跳: 持有期間 owner.json 之修改時間持續更新, 持有逾 staleMs 數倍仍不被判殘留; 釋放後停止心跳', async function() {
        let lockDir = dirOf()
        let staleMs = 300
        let a = createDirLock({ lockDir, staleMs })
        assert.strictEqual(a.tryLock(), true)
        let fp = path.join(lockDir, 'owner.json')
        setMtime(fp, 10000) //把修改時間倒回: 若沒有心跳, 立即會被判殘留
        let t0 = Date.now()
        setMtime(lockDir, 10000)
        await waitUntil(() => fs.statSync(fp).mtimeMs > t0 - 1000, 20000, '心跳把 owner.json 之修改時間更新')
        await waitUntil(() => fs.statSync(lockDir).mtimeMs > t0 - 1000, 20000, '心跳亦更新鎖資料夾之修改時間(owner.json 暫時讀不到時之判定依據)')
        let t1 = Date.now()
        await waitUntil(() => Date.now() - t1 > staleMs * 4, 20000, '持有已逾殘留判定時長之 4 倍')
        assert.strictEqual(createDirLock({ lockDir, staleMs }).judge(), null, '持有者持續心跳, 不得被判殘留')
        a.release()
        assert.strictEqual(fs.existsSync(lockDir), false)
    })

    it('[DL08] 取鎖時 mkdir 遇 EPERM／EBUSY／EACCES: 鎖資料夾仍在視為占用(false); 鎖資料夾不在而連續被拒滿 100 次才拋出原錯誤', function() {
        let lockDir = dirOf()
        let orig = fs.mkdirSync
        let calls = 0
        try {
            fs.mkdirSync = () => {
                calls++
                throw Object.assign(new Error('x'), { code: 'EPERM' })
            }
            fs.writeFileSync(path.join(path.dirname(lockDir), 'marker'), '') //鎖資料夾不在(只有上層)
            let a = createDirLock({ lockDir })
            for (let i = 1; i <= 99; i++) {
                assert.strictEqual(a.tryLock(), false, `第 ${i} 次被拒: 暫時視為占用`)
            }
            assert.throws(() => a.tryLock(), (err) => err.code === 'EPERM', '連續第 100 次被拒應拋出')
            assert.strictEqual(calls, 100)
        }
        finally {
            fs.mkdirSync = orig
        }
        //鎖資料夾在: 被拒不累計
        fs.mkdirSync(lockDir)
        try {
            fs.mkdirSync = () => {
                throw Object.assign(new Error('x'), { code: 'EBUSY' })
            }
            let b = createDirLock({ lockDir })
            for (let i = 0; i < 150; i++) {
                assert.strictEqual(b.tryLock(), false)
            }
        }
        finally {
            fs.mkdirSync = orig
        }
    })

    it('[DL09] 取鎖遇其他錯誤(上層資料夾不存在)即拋出, 不當成被占用', function() {
        let lockDir = path.join(dirOf(), '..', 'no-such-parent', '.lock')
        assert.throws(() => createDirLock({ lockDir }).tryLock(), (err) => err.code === 'ENOENT')
    })

    it('[DL10] 建了鎖資料夾卻寫不出 owner.json: 不遺留無主之鎖, 回傳 false', function() {
        let lockDir = dirOf()
        let orig = fs.writeFileSync
        let a = createDirLock({ lockDir })
        try {
            fs.writeFileSync = () => {
                throw Object.assign(new Error('x'), { code: 'ENOSPC' })
            }
            assert.strictEqual(a.tryLock(), false)
        }
        finally {
            fs.writeFileSync = orig
        }
        assert.strictEqual(fs.existsSync(lockDir), false, '不得留下無 owner 之鎖資料夾')
        assert.strictEqual(a.tryLock(), true, '其後可正常取得')
        a.release()
    })

    it('[DL11] 參數: lockDir 須為非空字串; staleMs 非預期之輸入(0、負數、字串、NaN、Infinity)視為未給而取預設', function() {
        for (let bad of [undefined, null, '', 5, {}]) {
            assert.throws(() => createDirLock({ lockDir: bad }), /lockDir/)
        }
        assert.throws(() => createDirLock(), /lockDir/)
        let lockDir = dirOf()
        fs.mkdirSync(lockDir)
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, token: 't' }))
        setMtime(path.join(lockDir, 'owner.json'), 60000) //1 分鐘前: 預設 150 秒內仍新鮮; 若誤用 0 或負數會判殘留
        for (let bad of [0, -1, '1', NaN, Infinity, null]) {
            assert.strictEqual(createDirLock({ lockDir, staleMs: bad }).judge(), null, `staleMs=${String(bad)} 應取預設`)
        }
        assert.deepStrictEqual(createDirLock({ lockDir, staleMs: 1000 }).judge(), { token: 't' }, '有效之 staleMs 照用')
    })

    it('[DL12] 真實已結束之行程: 預設之 isAlive(pidExists)判定其不存在而回收', function() {
        let lockDir = dirOf()
        fs.mkdirSync(lockDir)
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: deadPid(), token: 'real-dead' }))
        let b = createDirLock({ lockDir })
        let judged = b.judge()
        assert.deepStrictEqual(judged, { token: 'real-dead' })
        assert.strictEqual(b.reclaim(judged), true)
    })

    it('[DL13] 心跳核對 owner: 鎖被他行程接手(owner.json 之 token 已不是自己)後, 原持有者之心跳不再刷新他人之鎖; 鎖被搬走(ENOENT)後心跳亦停止', async function() {
        let lockDir = dirOf()
        let a = createDirLock({ lockDir, staleMs: 300 }) //心跳間隔 100 毫秒
        assert.strictEqual(a.tryLock(), true)
        let fp = path.join(lockDir, 'owner.json')
        fs.writeFileSync(fp, JSON.stringify({ pid: process.pid, token: 'someone-else' })) //模擬已被回收並由他人建立新鎖
        setMtime(fp, 60000)
        let n = 0
        let orig = fs.utimesSync
        try {
            fs.utimesSync = (...x) => {
                n++
                return orig(...x)
            }

            //否定斷言之短暫觀察窗: 心跳至少已執行 4 輪(以 owner.json 之讀取為事件不可行, 取觀察窗長度 ≥ 4 倍間隔)
            let t0 = Date.now()
            await waitUntil(() => Date.now() - t0 > 600, 20000, '觀察窗 600 毫秒(≥ 4 輪心跳)')
            assert.strictEqual(n, 0, '被接手後之心跳不得更新他人之鎖(utimes 次數)')
            assert.ok(Date.now() - fs.statSync(fp).mtimeMs > 50000, '他人之 owner.json 之修改時間不得被刷新')
        }
        finally {
            fs.utimesSync = orig
        }
        a.release() //owner 非自己: 不刪他人之鎖
        assert.ok(fs.existsSync(lockDir))
    })

    it('[DL14] 建鎖遇「鎖資料夾不在而被拒」之連續計數於鎖資料夾存在(EEXIST)時中斷', function() {
        let lockDir = dirOf()
        let orig = fs.mkdirSync
        let seq = []
        try {
            fs.mkdirSync = () => {
                let code = seq.shift()
                throw Object.assign(new Error('x'), { code })
            }
            let a = createDirLock({ lockDir })
            seq = Array.from({ length: 99 }, () => 'EPERM')
            for (let i = 0; i < 99; i++) {
                assert.strictEqual(a.tryLock(), false)
            }
            seq = ['EEXIST']
            assert.strictEqual(a.tryLock(), false)
            seq = Array.from({ length: 99 }, () => 'EPERM')
            for (let i = 0; i < 99; i++) {
                assert.strictEqual(a.tryLock(), false, `EEXIST 後第 ${i + 1} 次被拒不得因先前之累計而拋出`)
            }
        }
        finally {
            fs.mkdirSync = orig
        }
    })

    it('[DL15] 同一實例於鎖被移除後再取得: 先前之心跳停止(不留兩個心跳計時器)', async function() {
        let lockDir = dirOf()
        let a = createDirLock({ lockDir, staleMs: 300 })
        assert.strictEqual(a.tryLock(), true)
        fs.rmSync(lockDir, { recursive: true, force: true }) //鎖被他行程回收
        assert.strictEqual(a.tryLock(), true)
        let intervals = 0
        let origSet = global.setInterval
        let origClear = global.clearInterval
        try {
            global.setInterval = (...x) => {
                intervals++
                return origSet(...x)
            }
            global.clearInterval = (t) => {
                intervals--
                return origClear(t)
            }
            fs.rmSync(lockDir, { recursive: true, force: true })
            assert.strictEqual(a.tryLock(), true)
            assert.strictEqual(intervals, 0, '再取得時先清除舊心跳(清除一個、建立一個, 淨增 0)')
        }
        finally {
            global.setInterval = origSet
            global.clearInterval = origClear
        }
        a.release()
    })

    it('[DL16] 鎖被搬走或刪除(owner.json 讀取得 ENOENT)後, 心跳自行停止(不空轉至釋放)', async function() {
        let lockDir = dirOf()
        let a = createDirLock({ lockDir, staleMs: 300 }) //心跳間隔 100 毫秒
        assert.strictEqual(a.tryLock(), true)
        let cleared = 0
        let orig = global.clearInterval
        try {
            global.clearInterval = (t) => {
                cleared++
                return orig(t)
            }
            fs.rmSync(lockDir, { recursive: true, force: true }) //鎖被他行程回收
            await waitUntil(() => cleared >= 1, 20000, '心跳發現鎖已不在而停止(clearInterval 被呼叫)')
        }
        finally {
            global.clearInterval = orig
        }
        a.release() //已無鎖: 不拋錯
    })

})
