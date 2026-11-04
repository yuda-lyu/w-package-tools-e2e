import fs from 'fs'
import net from 'net'
import path from 'path'
import assert from 'assert'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import pidExists from '../src/pidExists.mjs'


//自動換埠之實機測試(規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md §3): 真實監聽行程, 占用者由測試自建並回驗毫髮無傷。
//夾具 test/tools/portFixtureRun.mjs 模擬一個套件之單開 e2e 啟動; 登錄目錄獨立於使用者之登錄目錄。
//固定埠(不隨機; 避開 19030、18930、19050、19051、19200～19500): 基準 19620(後端)、19630(前端), 位移 100 起。


let fdPkg = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
let fpRun = path.join(fdPkg, 'test', 'tools', 'portFixtureRun.mjs')
let fpSrv = path.join(fdPkg, 'test', 'tools', 'portFixtureSrv.mjs')
let fdRoot = path.resolve('test/_tmp/apiReserveE2ePorts')
let BACK = 19620
let FRONT = 19630
let cnt = 0
let spawned = []


function mkCase() {
    let fd = path.join(fdRoot, `c${++cnt}`)
    let root = path.join(fd, 'proj')
    let reg = path.join(fd, 'reg')
    fs.mkdirSync(root, { recursive: true })
    return { fd, root, reg, fpRecord: path.join(fd, 'record.jsonl'), fpGate: path.join(fd, 'gate'), fpGate0: path.join(fd, 'gate0') }
}


function runFixture(c, over = {}) {
    let child = spawn(process.execPath, [fpRun], {
        cwd: over.cwd || c.root,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
            ...process.env,
            E2E_PORT_REG_DIR: c.reg,
            E2E_PORT_OFFSET: '',
            E2E_PORT_HOLD: '',
            PF_PORTS: `${over.back || BACK},${over.front || FRONT}`,
            PF_RECORD: c.fpRecord,
            PF_GATE: c.fpGate,
            PF_GATE0: c.fpGate0,
            PF_TAG: over.tag || '',
            ...over.env,
        },
    })
    spawned.push(child)
    let out = ''
    child.stdout.on('data', (d) => {
        out += d
    })
    child.stderr.on('data', (d) => {
        out += d
    })
    let closed = new Promise((resolve) => child.on('close', (code) => resolve(code)))
    return { child, closed, out: () => out }
}


let readRecords = (c) => (fs.existsSync(c.fpRecord) ? fs.readFileSync(c.fpRecord, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])


async function until(fn, label, ms = 90000) {
    let t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (fn()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`等待逾時: ${label}`)
}


//占用者: 自建之獨立行程, 真實監聽
async function spawnOccupant(port, host = '127.0.0.1') {
    let child = spawn(process.execPath, [fpSrv, 'occupant', String(port), host], { stdio: 'ignore', windowsHide: true })
    spawned.push(child)
    let url = `http://${host.includes(':') ? `[${host === '::' ? '::1' : host}]` : (host === '0.0.0.0' ? '127.0.0.1' : host)}:${port}/`
    await until(() => child.exitCode === null, '占用者存活')
    let t0 = Date.now()
    while (Date.now() - t0 < 30000) {
        try {
            let j = await (await fetch(url)).json()
            if (j.pid === child.pid) {
                return { child, port, url }
            }
        }
        catch (err) {}
        if (child.exitCode !== null) {
            throw new Error(`占用者無法綁定 ${host}:${port}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('占用者未就緒')
}


//占用者毫髮無傷: 同一 PID 仍存活且仍在該埠回應
async function assertOccupantIntact(o) {
    assert.strict.equal(o.child.exitCode, null, '占用者不得結束')
    assert.strict.equal(pidExists(o.child.pid), true)
    let j = await (await fetch(o.url)).json()
    assert.strict.deepEqual([j.role, j.pid, j.port], ['occupant', o.child.pid, o.port])
}


function stopChild(child) {
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
    }
}


//只殺本測試自建之服務(紀錄內之 PID)
function killPids(pids) {
    for (let p of pids) {
        if (pidExists(p)) {
            spawnSync('taskkill', ['/F', '/PID', String(p)], { stdio: 'ignore', windowsHide: true })
        }
    }
}


//起服務(shell:true, 同 npm run serve), 等背景取樣把實際監聽之服務記入預約檔, 再硬殺持有者(TerminateProcess; 服務成孤兒)
async function startThenHardKill(c) {
    let r1 = runFixture(c, { env: { PF_SHELL: '1' } })
    await until(() => readRecords(c).some((v) => v.stage === 'up'), `就緒; ${r1.out()}`)
    let up = readRecords(c).find((v) => v.stage === 'up')
    let pids = [up.served.pid, up.served.backend.pid]
    await until(() => {
        try {
            let known = JSON.parse(fs.readFileSync(path.join(c.reg, `p${FRONT}.json`), 'utf8')).known
            return pids.every((p) => known.some((k) => k.pid === p))
        }
        catch (err) {
            return false
        }
    }, '取樣寫入預約檔')
    spawnSync('taskkill', ['/F', '/PID', String(r1.child.pid)], { stdio: 'ignore', windowsHide: true })
    await r1.closed
    for (let p of pids) {
        assert.strict.equal(pidExists(p), true, `硬殺後服務 ${p} 成孤兒`)
    }
    return { r1, pids }
}


function bindFree(port) {
    return new Promise((resolve) => {
        let s = net.createServer()
        s.once('error', () => resolve(false))
        s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
    })
}


describe('reserveE2ePorts 實機', function() {

    this.timeout(170000)

    before(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    afterEach(function() {
        spawned.splice(0).forEach(stopChild)
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    })

    //規格 §3 ①: 人為占用基準埠, 仍全綠且不動到占用者
    for (let host of ['127.0.0.1', '0.0.0.0', '::1']) {
        it(`[RA1] 基準埠被占用(綁 ${host}): 換埠、前後端皆可連且對應關係不變、占用者毫髮無傷、實際埠印入輸出`, async function() {
            let c = mkCase()
            let o = await spawnOccupant(FRONT, host).catch((err) => {
                if (host === '::1') {
                    return this.skip()
                }
                throw err
            })
            let r = runFixture(c)
            await until(() => readRecords(c).some((v) => v.stage === 'up'), `服務就緒; 輸出 ${r.out()}`)
            let rec = readRecords(c)
            let reserved = rec.find((v) => v.stage === 'reserved')
            //E2、E3: 整組移位
            assert.strict.deepEqual(reserved.ports, [BACK + 100, FRONT + 100])
            assert.strict.equal(reserved.baseUrl, `http://127.0.0.1:${FRONT + 100}/`)
            //E3: 前端(依繼承之環境變數)連到同一實例之後端
            let up = rec.find((v) => v.stage === 'up')
            assert.strict.deepEqual([up.served.role, up.served.port, up.served.backend.port], ['front', FRONT + 100, BACK + 100])
            await assertOccupantIntact(o)
            //E6: 實際使用之埠印入輸出; E5: 訊息寫明誰占用
            assert.strict.ok(r.out().includes(`實際埠 [${BACK + 100}, ${FRONT + 100}]`), r.out())
            assert.strict.ok(r.out().includes(`埠 ${FRONT}`) && r.out().includes(`PID ${o.child.pid}`), r.out())
            fs.writeFileSync(c.fpGate, 'open')
            assert.strict.equal(await r.closed, 0, r.out())
            await assertOccupantIntact(o)
            //收尾: 自建服務結束、預約釋放
            assert.strict.equal(pidExists(up.backPid), false)
            assert.strict.equal(await bindFree(BACK + 100), true)
            assert.strict.deepEqual(fs.readdirSync(c.reg), [])
        })
    }

    //規格 §3 ②、主控已定 4: 兩個行程同時開跑
    it('[RA2] 兩個行程同時開跑(重複 5 次): 拿到不同組埠、皆能綁定、各連到自己之服務', async function() {
        for (let round = 0; round < 5; round++) {
            let c = mkCase()
            let a = runFixture(c, { tag: 'a' })
            let b = runFixture(c, { tag: 'b' })
            await until(() => readRecords(c).filter((v) => v.stage === 'up').length === 2, `第 ${round} 輪兩者就緒; a=${a.out()} b=${b.out()}`)
            let ups = readRecords(c).filter((v) => v.stage === 'up')
            let [ra, rb] = ['a', 'b'].map((t) => readRecords(c).find((v) => v.stage === 'reserved' && v.tag === t))
            assert.strict.notDeepEqual(ra.ports, rb.ports, `第 ${round} 輪`)
            assert.strict.deepEqual(new Set([...ra.ports, ...rb.ports]).size, 4, '兩組無重疊')
            assert.strict.deepEqual([ra.offset, rb.offset].sort((x, y) => x - y), [0, 100], `第 ${round} 輪: 一個基準、一個移位(${ra.offset}, ${rb.offset})`)
            for (let v of ups) {
                let rv = v.tag === 'a' ? ra : rb
                assert.strict.deepEqual([v.served.port, v.served.backend.port], [rv.ports[1], rv.ports[0]], '各連到自己之服務')
            }
            fs.writeFileSync(c.fpGate, 'open')
            assert.strict.deepEqual([await a.closed, await b.closed], [0, 0], `a=${a.out()} b=${b.out()}`)
            assert.strict.deepEqual(fs.readdirSync(c.reg), [], '預約全部釋放')
        }
    })

    it('[RA2b] 六個行程同時開跑: 全部拿到不同組埠且皆能綁定', async function() {
        let c = mkCase()
        let tags = ['a', 'b', 'c', 'd', 'e', 'f']
        let rs = tags.map((tag) => runFixture(c, { tag }))
        await until(() => readRecords(c).filter((v) => v.stage === 'up').length === tags.length, `全部就緒; ${rs.map((r) => r.out()).join('|')}`)
        let offsets = readRecords(c).filter((v) => v.stage === 'reserved').map((v) => v.offset)
        assert.strict.equal(new Set(offsets).size, tags.length, offsets.join(','))
        fs.writeFileSync(c.fpGate, 'open')
        assert.strict.deepEqual(await Promise.all(rs.map((r) => r.closed)), tags.map(() => 0))
    })

    //規格 §3 ③、實測要求③
    it('[RA3] 釋放後恢復基準埠: 占用者結束、前一次跑完後再跑即基準埠', async function() {
        let c = mkCase()
        let o = await spawnOccupant(FRONT)
        let r1 = runFixture(c)
        await until(() => readRecords(c).some((v) => v.stage === 'up'), `就緒; ${r1.out()}`)
        fs.writeFileSync(c.fpGate, 'open')
        await r1.closed
        stopChild(o.child)
        await until(() => !pidExists(o.child.pid), '占用者已停')
        let r2 = runFixture(c)
        await r2.closed
        let reserved = readRecords(c).filter((v) => v.stage === 'reserved')
        assert.strict.deepEqual(reserved.map((v) => v.offset), [100, 0])
        assert.strict.deepEqual(reserved[1].ports, [BACK, FRONT])
    })

    //主控已定 3、4: 預約殘留回收; 正面確認是本實例之殘留才殺
    it('[RA4] 持有者被硬殺、服務成孤兒: 下次開跑(同專案)回收預約、依身分殺殘留、回到基準埠', async function() {
        let c = mkCase()
        let { r1, pids } = await startThenHardKill(c)
        try {
            assert.strict.deepEqual(fs.readdirSync(c.reg).sort(), [`p${BACK}.json`, `p${FRONT}.json`], '預約檔殘留')
            fs.writeFileSync(c.fpGate, 'open')
            let r2 = runFixture(c)
            assert.strict.equal(await r2.closed, 0, r2.out())
            let last = readRecords(c).filter((v) => v.stage === 'reserved').pop()
            assert.strict.deepEqual(last.ports, [BACK, FRONT], r2.out())
            for (let p of pids) {
                assert.strict.equal(pidExists(p), false, `殘留 ${p} 應被終止`)
            }
            assert.strict.ok(/階段 stale-reservation/.test(r2.out()) && /依據 identity/.test(r2.out()), r2.out())
        }
        finally {
            r1.child.kill()
            killPids(pids)
        }
    })

    it('[RA4b] 持有者被硬殺, 但下次開跑屬另一專案: 不殺他人殘留, 回收預約後因埠被占用而換埠', async function() {
        let c = mkCase()
        let rootB = path.join(c.fd, 'projB')
        fs.mkdirSync(rootB, { recursive: true })
        let { pids } = await startThenHardKill(c)
        fs.writeFileSync(c.fpGate, 'open')
        try {
            let r2 = runFixture(c, { cwd: rootB })
            assert.strict.equal(await r2.closed, 0, r2.out())
            let last = readRecords(c).filter((v) => v.stage === 'reserved').pop()
            assert.strict.deepEqual(last.ports, [BACK + 100, FRONT + 100], r2.out())
            for (let p of pids) {
                assert.strict.equal(pidExists(p), true, `他專案之殘留 ${p} 不得下殺`)
            }
        }
        finally {
            killPids(pids)
        }
    })

    it('[RA5] 保留前已取實際埠(誤用): 拋錯, 不繼續', async function() {
        let c = mkCase()
        let r = runFixture(c, { env: { PF_EARLY: '1' } })
        assert.strict.equal(await r.closed, 5, r.out())
        let rec = readRecords(c).find((v) => v.stage === 'reserve-error')
        assert.strict.ok(/已於保留前呼叫/.test(rec.message), rec.message)
    })

    it('[RA6] 重選用盡(真實占用): 停止、訊息寫明誰占用、占用者毫髮無傷', async function() {
        let c = mkCase()
        let o1 = await spawnOccupant(FRONT)
        let o2 = await spawnOccupant(FRONT + 100)
        let r = runFixture(c, { env: { PF_OPTS: JSON.stringify({ maxTries: 2 }) } })
        assert.strict.equal(await r.closed, 5, r.out())
        let rec = readRecords(c).find((v) => v.stage === 'reserve-error')
        assert.strict.equal(rec.code, 'E2E_PORT_EXHAUSTED')
        assert.strict.ok(rec.message.includes(`PID ${o1.child.pid}`) && rec.message.includes(`PID ${o2.child.pid}`), rec.message)
        await assertOccupantIntact(o1)
        await assertOccupantIntact(o2)
        assert.strict.deepEqual(fs.readdirSync(c.reg), [])
    })

    //E7: 只能在基準埠跑, 被占用時等待, 不換埠
    it('[RA7] baseOnly: 被占用時等待不換埠; 占用者結束後跑在基準埠', async function() {
        let c = mkCase()
        let o = await spawnOccupant(FRONT)
        let r = runFixture(c, { env: { PF_OPTS: JSON.stringify({ baseOnly: true, waitPollMs: 100 }) } })
        await until(() => r.out().includes('等待中'), `等待中; ${r.out()}`)
        assert.strict.deepEqual(readRecords(c), [], '等待期間尚未選定')
        await assertOccupantIntact(o)
        stopChild(o.child)
        await until(() => readRecords(c).some((v) => v.stage === 'up'), `就緒; ${r.out()}`)
        let up = readRecords(c).find((v) => v.stage === 'up')
        assert.strict.deepEqual([up.served.port, up.served.backend.port], [FRONT, BACK])
        fs.writeFileSync(c.fpGate, 'open')
        assert.strict.equal(await r.closed, 0, r.out())
    })

    it('[RA7b] baseOnly 逾時: 拋錯寫明誰占用, 占用者毫髮無傷', async function() {
        let c = mkCase()
        let o = await spawnOccupant(BACK)
        let r = runFixture(c, { env: { PF_OPTS: JSON.stringify({ baseOnly: true, waitTimeoutMs: 800, waitPollMs: 100 }) } })
        assert.strict.equal(await r.closed, 5, r.out())
        let rec = readRecords(c).find((v) => v.stage === 'reserve-error')
        assert.strict.equal(rec.code, 'E2E_PORT_BASE_BUSY')
        assert.strict.ok(rec.message.includes(`PID ${o.child.pid}`), rec.message)
        await assertOccupantIntact(o)
    })

    //E5: 偵測與綁定之間被搶走; E4: 絕不殺占用者
    it('[RA8] 保留後才被他人占走(未導入者): 不沿用、不下殺, 訊息寫明占用者; restart 亦不下殺', async function() {
        let c = mkCase()
        let r = runFixture(c, { env: { PF_STAGE: 'hold-before-start', PF_RESTART: '1' } })
        await until(() => readRecords(c).some((v) => v.stage === 'reserved'), `已保留; ${r.out()}`)
        let o = await spawnOccupant(BACK)
        fs.writeFileSync(c.fpGate0, 'open')
        assert.strict.equal(await r.closed, 6, r.out())
        let rec = readRecords(c)
        let startErr = rec.find((v) => v.stage === 'start-error')
        assert.strict.ok(/保留後被他人占用/.test(startErr.message) && startErr.message.includes(`PID ${o.child.pid}`), startErr.message)
        let restartErr = rec.find((v) => v.stage === 'restart-error')
        assert.strict.ok(/非本實例之行程占用.*不下殺/s.test(restartErr.message) && restartErr.message.includes(`PID ${o.child.pid}`), restartErr.message)
        await assertOccupantIntact(o)
    })

    //與逐檔 runner 之關係: 上層保留, 子行程沿用
    it('[RA9] 上層保留後子行程(繼承環境變數)沿用同一組埠, 不再換埠、不沿用失敗', async function() {
        let c = mkCase()
        let o = await spawnOccupant(FRONT)
        let r = runFixture(c, { env: { PF_CHILD: '1' } })
        await until(() => readRecords(c).some((v) => v.stage === 'child-exit'), `子行程結束; ${r.out()}`)
        let rec = readRecords(c)
        let parent = rec.find((v) => v.stage === 'reserved' && v.tag === '')
        let child = rec.find((v) => v.stage === 'reserved' && v.tag === 'child')
        assert.strict.deepEqual([parent.source, child.source], ['auto', 'inherited'])
        assert.strict.deepEqual(child.ports, parent.ports)
        assert.strict.equal(rec.find((v) => v.stage === 'child-exit').status, 0, '子行程沿用上層之服務')
        assert.strict.ok(rec.some((v) => v.stage === 'up' && v.tag === 'child' && v.served.port === FRONT + 100), JSON.stringify(rec))
        fs.writeFileSync(c.fpGate, 'open')
        assert.strict.equal(await r.closed, 0, r.out())
        await assertOccupantIntact(o)
    })

    //E4 之例外: 正面確認是本實例之服務才殺; 其他服務與占用者不動
    it('[RA10] restart 依身分殺本實例之監聽者(真實下殺): 只換後端, 前端不動, 新後端可連, 占用者毫髮無傷', async function() {
        let c = mkCase()
        let o = await spawnOccupant(FRONT)
        let r = runFixture(c, { env: { PF_CHILD: '1', PF_CHILD_RESTART: '1' } })
        await until(() => readRecords(c).some((v) => v.stage === 'child-exit'), `子行程結束; ${r.out()}`)
        let rec = readRecords(c)
        assert.strict.equal(rec.find((v) => v.stage === 'child-exit').status, 0, JSON.stringify(rec))
        let up = rec.find((v) => v.stage === 'up' && v.tag === '')
        let done = rec.find((v) => v.stage === 'restarted')
        assert.ok(done, JSON.stringify(rec))
        assert.strict.equal(done.oldBackPid, up.served.backend.pid)
        assert.strict.notEqual(done.served.backend.pid, done.oldBackPid, '後端已換新')
        assert.strict.equal(done.served.backend.port, BACK + 100)
        assert.strict.equal(pidExists(done.oldBackPid), false, '舊後端已被殺')
        assert.strict.equal(done.served.pid, up.served.pid, '前端不動')
        assert.strict.equal(pidExists(up.served.pid), true, '前端不動')
        await assertOccupantIntact(o)
        fs.writeFileSync(c.fpGate, 'open')
        assert.strict.equal(await r.closed, 0, r.out())
    })

})
