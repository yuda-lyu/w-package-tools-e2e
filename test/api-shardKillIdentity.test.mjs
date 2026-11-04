import fs from 'fs'
import net from 'net'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import listDirLinks from '../src/listDirLinks.mjs'
import runShardedE2e from '../src/runShardedE2e.mjs'
import { psOut, ok } from './tools/portPidsFake.mjs'


//runShardedE2e 之下殺判定(規格見 sgud/rule/rulebook_shard.md S-W*): 真 spawn mocha、真鎖檔; 行程表以真實表疊加夾具列, 下殺一律攔下不轉送。
//不變式: 本檔不會對任何真實行程下殺(注入之 kill 只記錄)。夾具列之 PID 為 9 位數, 不可能是真實行程。變異測試只跑本檔與 unit-shardProcIdentity。
//固定埠 19500(只有占埠案使用)。


let require = createRequire(import.meta.url)
let realMocha = path.dirname(require.resolve('mocha/package.json'))
let fdRoot = path.resolve('test/_tmp/shardKillIdentity')
let PORT_BUSY = 19500
let cnt = 0
let CMD_TABLE = 'Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { \'{0} {1} {2} {3}\' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().ToString(\'o\'), $_.Name } }'


function realRows() {
    let r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', CMD_TABLE], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
    return String(r.stdout || '').split(/\r?\n/).map((l) => {
        let m = /^(\d+) (\d+) (\S+) ?(.*)$/.exec(l.trim())
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), startMs: Date.parse(m[3]), image: m[4] } : null
    }).filter(Boolean)
}


//疊加執行函數: extra(rows) 回傳要加入之夾具列; 下殺只記錄; 其餘真實執行
function overlayExec(o = {}) {
    let { extra = () => [], tableFail = () => false } = o
    let rec = { kills: [], tableCalls: 0, lastRows: [] }
    let exec = (prog, args, opt) => {
        if (opt.src === 'table') {
            rec.tableCalls++
            if (tableFail()) {
                return { status: 1, stdout: '' }
            }
            let rows = realRows()
            rows = [...rows, ...extra(rows)]
            rec.lastRows = rows
            return { status: 0, stdout: rows.map((r) => `${r.pid} ${r.ppid} ${new Date(r.startMs).toISOString()} ${r.image}`).join('\r\n') }
        }
        if (opt.src === 'kill') {
            rec.kills.push(...opt.targets)
            return { status: 0, stdout: opt.targets.map((t) => `${t.pid} killed`).join('\r\n') }
        }
        return spawnSync(prog, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: opt.timeout, maxBuffer: opt.maxBuffer, windowsHide: true })
    }
    return { exec, rec }
}


//小專案: 一個 e2e 檔; body 為 it 內容
function mkProj(body = '') {
    let root = path.join(fdRoot, `c${++cnt}`, 'proj')
    fs.mkdirSync(path.join(root, 'test'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fix"}')
    fs.symlinkSync(realMocha, path.join(root, 'node_modules', 'mocha'), 'junction')
    fs.writeFileSync(path.join(root, 'test', 'e2e-a.test.mjs'), `
import fs from 'fs'
describe('a', function() {
    it('x', async function() {
        ${body}
    })
})
`)
    let fdCase = path.dirname(root)
    let fpGate = path.join(fdCase, 'gate')
    let fpEnv = path.join(fdCase, 'env.txt')
    return { root, fdCase, fpGate, fpEnv, workDir: path.join(root, 'tmp', 'e2e-shards'), fpLock: path.join(root, 'tmp', 'e2e-shards', 'shard.lock') }
}


function runProj(fx, over = {}) {
    let logs = []
    process.env.KI_GATE = fx.fpGate
    process.env.KI_ENV = fx.fpEnv
    let pm = runShardedE2e({ root: fx.root, ports: [], availMemGb: 64, instances: 1, progressMs: 3600000, log: (s) => logs.push(String(s)), ...over })
    return { pm, logs }
}


let waitGateBody = `
        fs.writeFileSync(process.env.KI_ENV, String(process.env.E2E_PORT_HOLD || ''))
        let t0 = Date.now()
        while (Date.now() - t0 < 60000 && !fs.existsSync(process.env.KI_GATE)) {
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
`


async function until(fn, label, ms = 60000) {
    let t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (fn()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`等待逾時: ${label}`)
}


function readLock(fx) {
    try {
        return JSON.parse(fs.readFileSync(fx.fpLock, 'utf8'))
    }
    catch (err) {
        return null
    }
}


//已結束之 PID(自建後結束)
function deadPid() {
    let r = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true })
    return r.pid
}


function writeStaleLock(fx, info) {
    fs.mkdirSync(fx.workDir, { recursive: true })
    fs.writeFileSync(fx.fpLock, JSON.stringify(info))
}


function safeRemove(fd) {
    if (!fs.existsSync(fd)) {
        return
    }
    for (let l of listDirLinks(fd)) {
        fs.unlinkSync(l.path)
    }
    assert.strict.deepEqual(listDirLinks(fd), [])
    fs.rmSync(fd, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}


//夾具列: 事故之下游鏈(PID 為 9 位數, 不是真實行程)
function victimsOf(parentPid, startMs) {
    return [
        { pid: 900000001, ppid: parentPid, startMs, image: 'nohup.exe' },
        { pid: 900000002, ppid: 900000001, startMs: startMs + 1, image: 'node.exe' },
        { pid: 900000003, ppid: 900000002, startMs: startMs + 2, image: 'claude.exe' },
        { pid: 900000004, ppid: 900000003, startMs: startMs + 3, image: 'bash.exe' },
        { pid: 900000005, ppid: 900000004, startMs: startMs + 4, image: 'node.exe' },
    ]
}
let VICTIM_PIDS = victimsOf(0, 0).map((v) => v.pid)


//本測試行程所起之 mocha(根): 以真實表辨識
function rootRowOf(rows, tBegin) {
    return rows.find((r) => r.ppid === process.pid && r.startMs >= tBegin && r.image.toLowerCase() === 'node.exe')
}


describe('runShardedE2e 之下殺判定(注入行程表與下殺)', function() {

    this.timeout(150000)

    before(function() {
        safeRemove(fdRoot)
        //埠預約之登錄目錄改到夾具內, 不碰使用者之登錄目錄
        process.env.E2E_PORT_REG_DIR = path.join(fdRoot, 'reg')
    })

    after(function() {
        delete process.env.KI_GATE
        delete process.env.KI_ENV
        delete process.env.E2E_PORT_REG_DIR
        safeRemove(fdRoot)
        assert.strict.ok(fs.existsSync(path.join(realMocha, 'package.json')), '本套件真實 mocha 仍在')
    })

    //事故: 根結束後其 PID 被回收給暫態 bash, bash 結束後留下 nohup(ppid=該 PID); 收尾時不得下殺
    it('[S-W1] 收尾遇事故之表: 根已結束, 下游鏈全部不下殺; 紀錄為空且 known 筆數已記', async function() {
        let fx = mkProj(waitGateBody)
        let tBegin = Date.now()
        let rootPid = null
        let { exec, rec } = overlayExec({
            extra: (rows) => {
                let root = rootRowOf(rows, tBegin)
                if (root) {
                    rootPid = root.pid
                    return []
                }
                return rootPid ? victimsOf(rootPid, Date.now()) : []
            },
        })
        let { pm, logs } = runProj(fx, { exec, treeSampleMs: 300 })
        await until(() => fs.existsSync(fx.fpEnv) && rootPid, '進入測試且取樣到根')
        fs.writeFileSync(fx.fpGate, 'open')
        let r = await pm
        assert.strict.deepEqual(rec.kills, [], '不得下殺')
        assert.strict.equal(r.exitCode, 0, logs.join('\n'))
        assert.strict.deepEqual(r.kills, [])
        //無證據之 nohup 記入 killSkipped
        assert.strict.ok(r.killSkipped.some((v) => v.pid === 900000001 && v.reason === 'no-evidence'), JSON.stringify(r.killSkipped))
        assert.strict.ok(r.knownCount.total >= 1, JSON.stringify(r.knownCount))
        let sum = JSON.parse(fs.readFileSync(path.join(r.outDir, 'summary.json'), 'utf8'))
        assert.strict.deepEqual(sum.kills, [])
        assert.strict.deepEqual(sum.knownCount, r.knownCount)
        assert.strict.ok(logs.some((l) => /\[shard\] 行程清理: known 現存 \d+ 筆\(累計 \d+\), 下殺 0 筆/.test(l)), logs.join('\n'))
    })

    //需求: 取樣不得把上述誤認寫入 known
    it('[S-W2] 取樣: 真子行程入 known; 其結束後下游鏈不入 known; 鎖檔內亦無; 收尾不下殺', async function() {
        let fx = mkProj(waitGateBody)
        let tBegin = Date.now()
        let stage = 1
        let rootPid = null
        let FAKE = 900000100
        let fakeStart = null
        let { exec, rec } = overlayExec({
            extra: (rows) => {
                let root = rootRowOf(rows, tBegin)
                if (root) {
                    rootPid = root.pid
                }
                if (!rootPid) {
                    return []
                }
                if (fakeStart === null) {
                    fakeStart = Date.now()
                }
                return stage === 1
                    ? [{ pid: FAKE, ppid: rootPid, startMs: fakeStart, image: 'cmd.exe' }]
                    : victimsOf(FAKE, fakeStart + 1000)
            },
        })
        let { pm, logs } = runProj(fx, { exec, treeSampleMs: 200 })
        await until(() => {
            let lk = readLock(fx)
            return lk && lk.known && lk.known.some((k) => k.pid === FAKE)
        }, '真子行程入 known')
        stage = 2
        let n0 = rec.tableCalls
        await until(() => rec.tableCalls >= n0 + 3, '再取樣數次')
        let lk = readLock(fx)
        assert.strict.ok(!lk.known.some((k) => k.pid === FAKE), '已結束者移除')
        for (let pid of VICTIM_PIDS) {
            assert.strict.ok(!lk.known.some((k) => k.pid === pid), `誤認不得入 known: ${pid}`)
        }
        fs.writeFileSync(fx.fpGate, 'open')
        let r = await pm
        assert.strict.deepEqual(rec.kills, [])
        assert.strict.equal(r.exitCode, 0, logs.join('\n'))
    })

    //需求: 自行以 Date.now() 記錄之根改為取得其真實起始時間; 埠保留之識別碼傳給子行程(使用端沿用, 不再換埠)
    it('[S-W3] 根之紀錄為行程表之真實起始時間; 鎖檔 procCreateMs 為本行程真實起始時間; mocha 帶埠保留識別碼; 鎖檔無 runId', async function() {
        let fx = mkProj(waitGateBody)
        let { exec, rec } = overlayExec()
        let { pm } = runProj(fx, { exec, treeSampleMs: 300 })
        await until(() => {
            let lk = readLock(fx)
            return lk && lk.known && lk.known.length >= 1 && fs.existsSync(fx.fpEnv)
        }, '根入 known')
        let lk = readLock(fx)
        let tBegin = lk.startMs
        let row = rootRowOf(rec.lastRows, tBegin)
        assert.strict.ok(row, '表內有根')
        assert.strict.deepEqual(lk.known.find((k) => k.pid === row.pid).startMs, row.startMs)
        assert.strict.equal(lk.procCreateMs, rec.lastRows.find((p) => p.pid === process.pid).startMs)
        assert.strict.equal(lk.runId, undefined)
        assert.strict.ok(fs.readFileSync(fx.fpEnv, 'utf8').length >= 16, 'mocha 之環境變數帶埠保留識別碼')
        assert.strict.equal(process.env.E2E_PORT_HOLD, undefined, '不污染本行程')
        fs.writeFileSync(fx.fpGate, 'open')
        let r = await pm
        assert.strict.equal(r.exitCode, 0)
    })

    //需求: 曾被取樣之真孤兒仍被下殺; 每次下殺都留紀錄
    it('[S-W4] 曾被取樣且身分相符者於收尾下殺: 紀錄入回傳值、[shard] 輸出與 summary.json', async function() {
        let fx = mkProj(waitGateBody)
        let tBegin = Date.now()
        let rootPid = null
        let FAKE = 900000200
        let fakeStart = null
        let { exec, rec } = overlayExec({
            extra: (rows) => {
                let root = rootRowOf(rows, tBegin)
                if (root) {
                    rootPid = root.pid
                }
                if (!rootPid) {
                    return []
                }
                if (fakeStart === null) {
                    fakeStart = Date.now()
                }
                return [{ pid: FAKE, ppid: rootPid, startMs: fakeStart, image: 'orphan.exe' }]
            },
        })
        let { pm, logs } = runProj(fx, { exec, treeSampleMs: 200 })
        await until(() => {
            let lk = readLock(fx)
            return lk && lk.known && lk.known.some((k) => k.pid === FAKE)
        }, '入 known')
        fs.writeFileSync(fx.fpGate, 'open')
        let r = await pm
        assert.strict.deepEqual(rec.kills, [{ pid: FAKE, startMs: fakeStart }])
        let want = { pid: FAKE, image: 'orphan.exe', startMs: fakeStart, start: new Date(fakeStart).toISOString(), basis: 'identity', phase: 'teardown', result: 'killed' }
        assert.strict.deepEqual(r.kills, [want])
        assert.strict.ok(logs.includes(`[shard] 下殺 PID ${FAKE} orphan.exe 起始 ${want.start} 依據 identity 階段 teardown 結果 killed`), logs.join('\n'))
        let sum = JSON.parse(fs.readFileSync(path.join(r.outDir, 'summary.json'), 'utf8'))
        assert.strict.deepEqual(sum.kills, [want])
        assert.strict.ok(sum.knownCount.total >= 2, JSON.stringify(sum.knownCount))
    })

    //需求: 鎖檔殘留清除同樣遵守不變式; 鎖檔可能已存放數日
    it('[S-W5] 鎖檔殘留: 事故之表與 PID 回收(差 30 秒)皆不下殺, 含存放數日之鎖', async function() {
        let fx = mkProj()
        let P = 900000300
        let Q = 900000301
        let tOld = Date.now() - 86400000 * 3
        writeStaleLock(fx, { pid: deadPid(), procCreateMs: tOld - 1000, startMs: tOld, root: fx.root, runId: 'old-run', known: [{ pid: P, startMs: tOld + 10 }, { pid: Q, startMs: tOld + 20 }] })
        let { exec, rec } = overlayExec({
            extra: () => [...victimsOf(P, tOld + 5000), { pid: Q, ppid: 4, startMs: tOld + 20 + 30000, image: 'recycled.exe' }, { pid: 900000310, ppid: Q, startMs: tOld + 60000, image: 'recycledChild.exe' }],
        })
        let { pm, logs } = runProj(fx, { exec })
        let r = await pm
        assert.strict.deepEqual(rec.kills, [])
        assert.strict.deepEqual(r.kills, [])
        assert.strict.equal(r.exitCode, 0, logs.join('\n'))
        assert.strict.ok(logs.some((l) => /接手已死之鎖/.test(l)), logs.join('\n'))
    })

    it('[S-W6] 鎖檔殘留: 身分相符者下殺; 未曾被取樣之孤兒不下殺; 依據與階段入紀錄', async function() {
        let fx = mkProj()
        let P = 900000400
        let M = 900000401
        let tOld = Date.now() - 3600000
        writeStaleLock(fx, { pid: deadPid(), procCreateMs: tOld - 1000, startMs: tOld, root: fx.root, known: [{ pid: P, startMs: tOld + 10 }] })
        let { exec, rec } = overlayExec({
            extra: () => [{ pid: P, ppid: 900000399, startMs: tOld + 10, image: 'stale.exe' }, { pid: M, ppid: 900000399, startMs: tOld + 20, image: 'unsampled.exe' }],
        })
        let { pm, logs } = runProj(fx, { exec })
        let r = await pm
        assert.strict.deepEqual(rec.kills.map((v) => v.pid), [P])
        assert.strict.deepEqual(r.kills.map((v) => [v.pid, v.basis, v.phase]), [[P, 'identity', 'stale-lock']])
        assert.strict.equal(r.exitCode, 0, logs.join('\n'))
    })

    //需求: 舊格式無法確認身分者不殺, 記警告
    it('[S-W7] 舊格式鎖檔: 不下殺(即使 PID 與起始時間皆相符), 記警告; 持有者 PID 存活時視為仍在', async function() {
        let fx = mkProj()
        let P = 900000500
        let tOld = Date.now() - 3600000
        writeStaleLock(fx, { pid: deadPid(), procStartMs: tOld, startMs: tOld, root: fx.root, groups: [{ pid: P, startMs: tOld + 10 }] })
        let { exec, rec } = overlayExec({
            extra: () => [{ pid: P, ppid: 900000499, startMs: tOld + 10, image: 'old.exe' }],
        })
        let { pm, logs } = runProj(fx, { exec })
        let r = await pm
        assert.strict.deepEqual(rec.kills, [])
        assert.strict.deepEqual(r.kills, [])
        assert.strict.ok(logs.some((l) => /舊格式鎖檔.*1 筆紀錄無法確認身分, 不下殺/.test(l)), logs.join('\n'))
        assert.strict.equal(r.exitCode, 0, logs.join('\n'))
        //持有者存活: 舊格式無 procCreateMs, 收嚴視為仍在
        let fx2 = mkProj()
        writeStaleLock(fx2, { pid: process.pid, procStartMs: tOld, startMs: tOld, root: fx2.root, groups: [] })
        let { exec: e2, rec: rec2 } = overlayExec()
        await assert.rejects(runShardedE2e({ root: fx2.root, ports: [], availMemGb: 64, instances: 1, exec: e2, log: () => {} }), /已有執行者/)
        assert.strict.deepEqual(rec2.kills, [])
        fs.rmSync(fx2.workDir, { recursive: true, force: true })
    })

    //需求: 取不到行程表時不下殺
    it('[S-W8] 全程取不到行程表: 不下殺、記警告, 正常跑完; 鎖檔 procCreateMs 為 null', async function() {
        let fx = mkProj(waitGateBody)
        let { exec, rec } = overlayExec({ tableFail: () => true })
        let { pm, logs } = runProj(fx, { exec, treeSampleMs: 200 })
        await until(() => fs.existsSync(fx.fpEnv), '進入測試')
        await until(() => rec.tableCalls >= 3, '取樣數次')
        assert.strict.equal(readLock(fx).procCreateMs, null)
        assert.strict.deepEqual(readLock(fx).known, [])
        fs.writeFileSync(fx.fpGate, 'open')
        let r = await pm
        assert.strict.deepEqual(rec.kills, [])
        assert.strict.deepEqual(r.kills, [])
        assert.strict.equal(r.exitCode, 0, logs.join('\n'))
        assert.strict.ok(logs.some((l) => /取行程表失敗.*不下殺/.test(l)), logs.join('\n'))
    })

    //需求: 永不下殺本行程及其祖先鏈
    it('[S-W9] 鎖檔殘留含本行程與父行程(PID 與起始時間皆相符): 不下殺, 記 protected', async function() {
        let fx = mkProj()
        let rows = realRows()
        let self = rows.find((p) => p.pid === process.pid)
        let par = rows.find((p) => p.pid === process.ppid)
        let known = [{ pid: self.pid, startMs: self.startMs }, ...(par ? [{ pid: par.pid, startMs: par.startMs }] : [])]
        writeStaleLock(fx, { pid: deadPid(), procCreateMs: 1, startMs: Date.now() - 1000, root: fx.root, runId: 'old-run', known })
        let { exec, rec } = overlayExec()
        let { pm, logs } = runProj(fx, { exec })
        let r = await pm
        assert.strict.deepEqual(rec.kills.filter((v) => [process.pid, process.ppid].includes(v.pid)), [])
        assert.strict.ok(r.killSkipped.some((v) => v.pid === process.pid && v.reason === 'protected'), JSON.stringify(r.killSkipped))
        assert.strict.ok(logs.some((l) => l.includes(`PID ${process.pid} `) && /不下殺/.test(l)), logs.join('\n'))
    })

    //需求: 這次無法事後證明之處, 要讓下次可查(例外路徑沒有彙整, 紀錄不得遺失)
    it('[S-W10] 鎖檔殘留下殺後預檢失敗: 例外帶 kills, summary.json 有紀錄; 無下殺之例外不建立輸出', async function() {
        let fx = mkProj()
        let P = 900000600
        let tOld = Date.now() - 3600000
        writeStaleLock(fx, { pid: deadPid(), procCreateMs: tOld - 1000, startMs: tOld, root: fx.root, runId: 'old-run', known: [{ pid: P, startMs: tOld + 10 }] })
        let { exec } = overlayExec({ extra: () => [{ pid: P, ppid: 900000599, startMs: tOld + 10, image: 'stale.exe' }] })
        let s = net.createServer()
        await new Promise((resolve) => s.listen(PORT_BUSY, '127.0.0.1', resolve))
        let outDir = path.join(fx.fdCase, 'out')
        try {
            let err = await runShardedE2e({ root: fx.root, ports: [PORT_BUSY], portTries: 1, availMemGb: 64, instances: 1, exec, outDir, log: () => {} }).then(() => null, (e) => e)
            assert.ok(err, '應拋錯')
            assert.strict.ok(/預檢失敗/.test(err.message), err.message)
            assert.strict.deepEqual(err.kills.map((v) => [v.pid, v.basis]), [[P, 'identity']])
            let sum = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'))
            assert.strict.deepEqual(sum.kills.map((v) => [v.pid, v.image, v.basis, v.phase]), [[P, 'stale.exe', 'identity', 'stale-lock']])
            //沒有下殺: 不建立輸出目錄
            let fx2 = mkProj()
            let outDir2 = path.join(fx2.fdCase, 'out')
            let { exec: e2 } = overlayExec()
            await assert.rejects(runShardedE2e({ root: fx2.root, ports: [PORT_BUSY], portTries: 1, availMemGb: 64, instances: 1, exec: e2, outDir: outDir2, log: () => {} }), /預檢失敗/)
            assert.strict.equal(fs.existsSync(outDir2), false)
        }
        finally {
            await new Promise((resolve) => s.close(resolve))
        }
    })

    //身分比對之容差為 0: 持有者 PID 存活而起始時間差 30 秒(在舊 60 秒容差內)即不是同一行程
    it('[S-W12] 鎖持有者 PID 存活但起始時間不完全相同: 視為已死可接手; 完全相同才擋下', async function() {
        let self = realRows().find((p) => p.pid === process.pid)
        let fx = mkProj()
        writeStaleLock(fx, { pid: process.pid, procCreateMs: self.startMs + 30000, startMs: Date.now() - 1000, root: fx.root, runId: 'old-run', known: [] })
        let { exec, rec } = overlayExec()
        let r = await runProj(fx, { exec }).pm
        assert.strict.equal(r.exitCode, 0)
        assert.strict.deepEqual(rec.kills, [])
        let fx2 = mkProj()
        writeStaleLock(fx2, { pid: process.pid, procCreateMs: self.startMs, startMs: Date.now() - 1000, root: fx2.root, runId: 'old-run', known: [] })
        let { exec: e2 } = overlayExec()
        await assert.rejects(runShardedE2e({ root: fx2.root, ports: [], availMemGb: 64, instances: 1, exec: e2, log: () => {} }), /已有執行者/)
        fs.rmSync(fx2.workDir, { recursive: true, force: true })
    })

    //占埠殘留: 開跑後才起之監聽者不一定是本次的, 無證據不殺(修前以「起始晚於開跑」即下殺)
    it('[S-W11] 收尾時埠仍被占用: 監聽者無證據不下殺, 大聲報錯、實例保留、離開碼非 0', async function() {
        let fx = mkProj(waitGateBody)
        let s = null
        let { exec, rec } = overlayExec({
            //以夾具列表達「開跑後才起之他人行程」(真正占埠者為本測試行程), 監聽者查詢回該 PID
            extra: () => [{ pid: 900000700, ppid: 4, startMs: Date.now() - 100, image: 'other.exe' }],
        })
        let execWithListener = (prog, args, opt) => {
            if (opt.src === 'netstat') {
                return ok(`  TCP    127.0.0.1:${PORT_BUSY}    0.0.0.0:0    LISTENING    900000700\r\n`)
            }
            if (opt.src === 'powershell') {
                return ok(psOut([[PORT_BUSY, '127.0.0.1', 0, 900000700]]))
            }
            return exec(prog, args, opt)
        }
        let { pm } = runProj(fx, { exec: execWithListener, ports: [PORT_BUSY] })
        await until(() => fs.existsSync(fx.fpEnv), '進入測試')
        s = net.createServer()
        await new Promise((resolve) => s.listen(PORT_BUSY, '127.0.0.1', resolve))
        fs.writeFileSync(fx.fpGate, 'open')
        let r = await pm
        try {
            assert.strict.deepEqual(rec.kills, [], '無證據不下殺')
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.ok(r.teardownErrors.some((e) => new RegExp(`埠 ${PORT_BUSY} 未釋放`).test(e)), r.teardownErrors.join('|'))
            assert.strict.ok(r.teardownErrors.some((e) => /實例 .*未刪除: 其埠未釋放/.test(e)), r.teardownErrors.join('|'))
            assert.strict.equal(fs.existsSync(path.join(fx.workDir, 'inst0', 'proj')), true)
        }
        finally {
            await new Promise((resolve) => s.close(resolve))
        }
        //釋放後重跑: 依拆除程序清掉殘留(閘門已開)
        let { exec: e2 } = overlayExec()
        let r2 = await runProj(fx, { exec: e2, ports: [PORT_BUSY] }).pm
        assert.strict.equal(r2.exitCode, 0)
        assert.strict.equal(fs.existsSync(fx.workDir), false)
    })

})
