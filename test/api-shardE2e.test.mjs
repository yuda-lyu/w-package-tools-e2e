import fs from 'fs'
import net from 'net'
import path from 'path'
import assert from 'assert'
import EventEmitter from 'events'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import listDirLinks from '../src/listDirLinks.mjs'
import pidExists from '../src/pidExists.mjs'
import runShardedE2e, { findProcessDescendants } from '../src/runShardedE2e.mjs'


//runShardedE2e 之真實整合: test/_tmp/shardE2e/ 下建小專案(小型 HTTP 服務 + mocha 檔, 以 resolveE2ePort 取埠), 真 spawn mocha、真 junction、真殺行程。
//目標完好一律以連結目標內之哨兵檔回驗, 不只看沒有報錯。規格見 sgud/rule/rulebook_shard.md。
//固定埠(不隨機): 基準 19200、位移 100 → 19200、19300、19400; 第二基準 19210。避開既有之 19030、18930、19050、19051。


let fdPkg = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
let fdRoot = path.resolve('test/_tmp/shardE2e')
let fpCli = path.join(fdPkg, 'tools', 'shardE2e.mjs')
let realMocha = path.join(fdPkg, 'node_modules', 'mocha')
let BASE = 19200
let SECRET = 'fixture-secret-value-9f3a'
let cnt = 0


let urlOf = (rel) => pathToFileURL(path.join(fdPkg, rel)).href


//各檔共用之夾具庫: 以 resolveE2ePort 取埠; 服務之 cwd 為實例根(Windows 下活著的行程會鎖住目錄)
//useShell 為 true 時同 npm run serve 之 shell:true: 服務之父為 cmd(libuv job 只連帶殺直屬子行程, mocha 被硬殺時 cmd 跟著死, 服務成孤兒且父子鏈已斷)
let libSrc = `
import fs from 'fs'
import { spawn, spawnSync } from 'child_process'
import resolveE2ePort from '${urlOf('src/resolveE2ePort.mjs')}'
export let port = resolveE2ePort(${BASE})
let child = null
let shellMode = false
export async function startSvc(useShell = false) {
    shellMode = useShell
    child = useShell
        ? spawn('node srv.mjs ' + port, { cwd: process.cwd(), stdio: 'ignore', windowsHide: true, shell: true })
        : spawn(process.execPath, ['srv.mjs', String(port)], { cwd: process.cwd(), stdio: 'ignore', windowsHide: true })
    let t0 = Date.now()
    while (Date.now() - t0 < 30000) {
        try {
            let r = await fetch('http://127.0.0.1:' + port + '/')
            if (r.ok) return child.pid
        }
        catch (err) {}
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('svc not ready')
}
export function stopSvc() {
    if (!child) return
    if (shellMode && process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
    else child.kill()
}
export function record(o) {
    fs.appendFileSync(process.env.SHARD_FIX_RECORD, JSON.stringify(o) + '\\n')
}
export async function hit(file) {
    let j = await (await fetch('http://127.0.0.1:' + port + '/')).json()
    record({ file, port, servedBy: j.port, cwd: process.cwd(), offset: process.env.E2E_PORT_OFFSET, envExists: fs.existsSync('.env'), mochaPid: process.pid, svcPid: j.pid })
}
export async function waitGate() {
    let t0 = Date.now()
    while (Date.now() - t0 < 150000) {
        if (fs.existsSync(process.env.SHARD_FIX_GATE)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('gate timeout')
}
`

let srvSrc = `
import http from 'http'
let port = Number(process.argv[2])
http.createServer((q, s) => s.end(JSON.stringify({ port, pid: process.pid, cwd: process.cwd() }))).listen(port, '127.0.0.1')
`

//各種行為之測試檔
let bodies = {
    ok: (name) => `
    it('${name} 連線本實例之服務', async function() {
        await hit('${name}')
    })`,
    ok2: (name) => `
    it('${name} 案一', async function() {
        await hit('${name}')
    })
    it('${name} 案二', function() {})`,
    skip: (name) => `
    it('${name} 連線本實例之服務', async function() {
        await hit('${name}')
    })
    it.skip('${name} 略過之案', function() {})`,
    fail: (name) => `
    it('${name} 先寫證據', async function() {
        await hit('${name}')
        fs.mkdirSync('testPending', { recursive: true })
        fs.writeFileSync('testPending/flow-E2E-001__2026-11-04_07-00-00-000__capture.png', 'from-instance')
        fs.writeFileSync('testPending/flow-E2E-001__2026-11-04_07-00-00-000__collect.json', '{}')
    })
    describe('巢狀', function() {
        it('${name} 會失敗之案', function() {
            throw new Error('fixture boom')
        })
    })`,
    hardkill: (name) => `
    it('${name} 硬殺自身之 mocha(服務成孤兒)', async function() {
        await hit('${name}')
        process.kill(process.pid)
        await new Promise((resolve) => setTimeout(resolve, 60000))
    })`,
    gate: (name) => `
    it('${name} 等閘門', async function() {
        await hit('${name}')
        await waitGate()
    })`,
}
bodies.gateShell = bodies.gate
bodies.passThenGate = (name) => `
    it('${name} 先過', function() {})${bodies.gate(name)}`
//服務經 shell 啟動之行為
let shellKinds = new Set(['hardkill', 'gateShell'])


function mkFixture(specs, over = {}) {
    let root = path.join(fdRoot, `c${++cnt}`, 'proj')
    fs.mkdirSync(path.join(root, 'test', 'tools'), { recursive: true })
    fs.mkdirSync(path.join(root, 'test', 'pics', 'flow'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules', '__sentinel__'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fix"}')
    fs.writeFileSync(path.join(root, '.env'), `SECRET=${SECRET}\n`)
    fs.writeFileSync(path.join(root, 'srv.mjs'), srvSrc)
    fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'copied')
    fs.writeFileSync(path.join(root, 'logs', 'huge.log'), 'not-copied')
    fs.writeFileSync(path.join(root, 'node_modules', '__sentinel__', 'keep.txt'), 'nm-sentinel')
    fs.writeFileSync(path.join(root, 'test', 'pics', 'flow', 'base.png'), 'pics-sentinel')
    fs.symlinkSync(realMocha, path.join(root, 'node_modules', 'mocha'), 'junction')
    fs.writeFileSync(path.join(root, 'test', 'tools', 'fixtureLib.mjs'), over.noAdopt ? libSrc.replace(/import resolveE2ePort from .*\n/, '').replace(/export let port = .*\n/, `export let port = ${BASE}\n`).replace('process.env.E2E_PORT_OFFSET', '\'0\'') : libSrc)
    for (let [name, kind] of Object.entries(specs)) {
        fs.writeFileSync(path.join(root, 'test', `e2e-${name}.test.mjs`), `
import fs from 'fs'
import { startSvc, stopSvc, hit, record, waitGate } from './tools/fixtureLib.mjs'
describe('${name}', function() {
    before(async function() {
        await startSvc(${shellKinds.has(kind)})
    })
    after(function() {
        stopSvc()
    })${bodies[kind](name)}
})
`)
    }
    let fdCase = path.dirname(root)
    let fpRecord = path.join(fdCase, 'record.jsonl')
    let fpGate = path.join(fdCase, 'gate')
    return {
        root,
        fdCase,
        fpRecord,
        fpGate,
        workDir: path.join(root, 'tmp', 'e2e-shards'),
        records: () => (fs.existsSync(fpRecord) ? fs.readFileSync(fpRecord, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    }
}


//目標完好(哨兵檔實測)
function assertTargetsIntact(fx) {
    assert.strict.equal(fs.readFileSync(path.join(fx.root, 'node_modules', '__sentinel__', 'keep.txt'), 'utf8'), 'nm-sentinel')
    assert.strict.equal(fs.readFileSync(path.join(fx.root, 'test', 'pics', 'flow', 'base.png'), 'utf8'), 'pics-sentinel')
    assert.strict.ok(fs.existsSync(path.join(fx.root, 'node_modules', 'mocha', 'bin', 'mocha.js')), 'node_modules/mocha 仍在')
    assert.strict.ok(fs.existsSync(path.join(realMocha, 'package.json')), '本套件真實 mocha 仍在')
    assert.strict.deepEqual(fs.readdirSync(path.join(fx.root, 'test', 'pics', 'flow')), ['base.png'])
}


//實例與工作目錄已移除; .env 副本隨之消失
function assertInstancesGone(fx) {
    assert.strict.equal(fs.existsSync(fx.workDir), false, `工作目錄仍存在: ${fx.workDir}`)
}


function bindFree(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        let s = net.createServer()
        s.once('error', () => resolve(false))
        s.listen(port, host, () => s.close(() => resolve(true)))
    })
}


async function runApi(fx, over = {}) {
    let logs = []
    process.env.SHARD_FIX_RECORD = fx.fpRecord
    process.env.SHARD_FIX_GATE = fx.fpGate
    let pm = runShardedE2e({ root: fx.root, ports: [BASE], availMemGb: 64, progressMs: 3600000, log: (s) => logs.push(String(s)), ...over })
    return { pm, logs }
}


//等條件成立(事件同步之上限保護; 條件來自子行程寫入之紀錄)
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


function spawnCli(fx, args) {
    let child = spawn(process.execPath, [fpCli, ...args], {
        cwd: fx.root,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, SHARD_FIX_RECORD: fx.fpRecord, SHARD_FIX_GATE: fx.fpGate },
    })
    let out = ''
    child.stdout.on('data', (d) => {
        out += d
    })
    child.stderr.on('data', (d) => {
        out += d
    })
    let closed = new Promise((resolve) => child.on('close', (code, sig) => resolve({ code, sig })))
    return { child, closed, out: () => out }
}


function runCliSync(fx, args) {
    let r = spawnSync(process.execPath, [fpCli, ...args], {
        cwd: fx.root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 150000,
        env: { ...process.env, SHARD_FIX_RECORD: fx.fpRecord, SHARD_FIX_GATE: fx.fpGate },
    })
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}


let psKernel32 = 'Add-Type -Namespace WSh -Name K -MemberDefinition \'[DllImport("kernel32.dll",SetLastError=true)] public static extern bool FreeConsole(); [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AttachConsole(uint p); [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool a); [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);\''


//Windows 下以真實主控台事件送給目標行程之主控台(ev: 0 為 Ctrl-C, 1 為 Ctrl-Break); 回傳離開碼
function sendConsoleEvent(pid, ev) {
    let ps = `
${psKernel32}
[WSh.K]::FreeConsole() | Out-Null
if (-not [WSh.K]::AttachConsole(${pid})) { exit 3 }
[WSh.K]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [WSh.K]::GenerateConsoleCtrlEvent(${ev}, 0)) { exit 4 }
Start-Sleep -Milliseconds 300
exit 0
`
    let r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 60000, stdio: 'ignore' })
    return r.status
}


//結束時拆掉夾具內之連結後才刪除(含真實 mocha 之 junction)
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


describe('runShardedE2e', function() {

    this.timeout(170000)

    before(function() {
        safeRemove(fdRoot)
    })

    after(function() {
        delete process.env.SHARD_FIX_RECORD
        delete process.env.SHARD_FIX_GATE
        safeRemove(fdRoot)
        //不得傷到本套件真實依賴
        assert.strict.ok(fs.existsSync(path.join(realMocha, 'package.json')))
    })

    describe('全綠與設定', function() {

        it('[S-I1] 各組跑在不同埠、彙整數字正確、實例已移除、連結目標完好', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok2', c: 'skip' })
            let durations = { 'e2e-a.test.mjs': 3, 'e2e-b.test.mjs': 2, 'e2e-c.test.mjs': 1 }
            let { pm, logs } = await runApi(fx, { instances: 3, durations })
            let r = await pm
            //實例跑在不同埠: 第 i 組位移 i×100, 服務確實回應於該埠
            let recs = fx.records()
            let by = Object.fromEntries(recs.map((v) => [v.file, v]))
            assert.strict.deepEqual([by.a.port, by.b.port, by.c.port], [BASE, BASE + 100, BASE + 200])
            assert.strict.deepEqual([by.a.servedBy, by.b.servedBy, by.c.servedBy], [BASE, BASE + 100, BASE + 200])
            assert.strict.deepEqual([by.a.offset, by.b.offset, by.c.offset], ['0', '100', '200'])
            //實例根為 cwd, .env 確實複製
            assert.strict.equal(by.b.cwd, path.join(fx.workDir, 'inst1', 'proj'))
            assert.strict.equal(by.a.envExists, true)
            //彙整
            assert.strict.equal(r.exitCode, 0)
            assert.strict.deepEqual([r.totals.passing, r.totals.failing, r.totals.pending], [4, 0, 1])
            assert.strict.deepEqual(r.totals.failures, [])
            assert.strict.deepEqual(r.groups.map((g) => [g.index, g.offset, g.passing, g.pending, g.complete]), [[0, 0, 1, 0, true], [1, 100, 2, 0, true], [2, 200, 1, 1, true]])
            assert.strict.ok(r.wallMs > 0 && r.groups.every((g) => g.ms > 0))
            assert.strict.ok(logs.includes('  4 passing (' + logs.find((l) => /passing \(/.test(l)).match(/\((.+)\)/)[1] + ')'))
            assert.strict.ok(logs.includes('  0 failing') && logs.includes('  1 pending'))
            //durations 實測印出但預設不改檔
            assert.strict.deepEqual(Object.keys(r.durations).sort(), Object.keys(durations))
            assert.strict.ok(logs.some((l) => l.includes('"durations"') && l.includes('e2e-a.test.mjs')))
            assert.strict.equal(fs.existsSync(path.join(fx.root, 'test', 'tools', 'e2eShard.json')), false)
            //收尾
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
            for (let p of [BASE, BASE + 100, BASE + 200]) {
                assert.strict.equal(await bindFree(p), true, `埠 ${p} 應已釋放`)
            }
            //log 分寫各組且落在 outDir; 憑證不入輸出
            for (let g of r.groups) {
                let s = fs.readFileSync(g.logPath, 'utf8')
                assert.strict.ok(/passing/.test(s), g.logPath)
                assert.strict.ok(!s.includes(SECRET))
                assert.strict.ok(g.logPath.startsWith(r.outDir))
            }
            assert.strict.ok(!logs.join('\n').includes(SECRET))
            assert.strict.ok(fs.existsSync(path.join(r.outDir, 'summary.json')))
            assert.strict.ok(!fs.readFileSync(path.join(r.outDir, 'summary.json'), 'utf8').includes(SECRET))
            //正式專案之 logs 未被動到(排除項之實例內容見 S-I22)
            assert.strict.equal(fs.readFileSync(path.join(fx.root, 'logs', 'huge.log'), 'utf8'), 'not-copied')
        })

        it('[S-I2] CLI 讀設定檔: officialOnly 在位移 0、together 同組; --update-durations 才寫回', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok', c: 'ok' })
            let fpCfg = path.join(fx.root, 'test', 'tools', 'e2eShard.json')
            fs.writeFileSync(fpCfg, JSON.stringify({
                ports: [BASE],
                instances: 5,
                officialOnly: ['e2e-c.test.mjs'],
                together: [['e2e-a.test.mjs', 'e2e-b.test.mjs']],
                durations: { 'e2e-a.test.mjs': 5, 'e2e-c.test.mjs': 1, 'e2e-gone.test.mjs': 9 },
            }))
            let r = runCliSync(fx, ['--update-durations'])
            assert.strict.equal(r.code, 0, r.out)
            let by = Object.fromEntries(fx.records().map((v) => [v.file, v]))
            assert.strict.equal(by.c.port, BASE) //officialOnly 在位移 0
            assert.strict.equal(by.a.port, by.b.port) //together 同組
            assert.strict.equal(by.a.port, BASE + 100)
            assert.strict.ok(/實例數 5 → 2|只有 2 個/.test(r.out), r.out)
            let cfg = JSON.parse(fs.readFileSync(fpCfg, 'utf8'))
            assert.strict.deepEqual(Object.keys(cfg.durations).sort(), ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs', 'e2e-gone.test.mjs'])
            assert.strict.ok(cfg.durations['e2e-a.test.mjs'] !== 5, '實測值已寫回')
            assert.strict.equal(cfg.durations['e2e-gone.test.mjs'], 9) //已知以外不動
            assert.strict.equal(cfg.instances, 5) //其他欄位不動
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I3] CLI --plan 只印分組與預估: 不建立任何東西、不跑、離開碼 0; 參數錯誤離開碼 2', function() {
            let fx = mkFixture({ a: 'ok', b: 'ok', c: 'ok' })
            let r = runCliSync(fx, ['--plan', '--instances', '2', '--ports', String(BASE), '--durations', '{"e2e-a.test.mjs":4,"e2e-b.test.mjs":2}', '--official-only', 'e2e-b.test.mjs'])
            assert.strict.equal(r.code, 0, r.out)
            assert.strict.ok(/分組 2 組\(要求 2\)/.test(r.out), r.out)
            assert.strict.ok(/第 0 組 位移 0 埠 \[19200\].*e2e-b\.test\.mjs/.test(r.out), r.out)
            assert.strict.ok(/第 1 組 位移 100 埠 \[19300\]/.test(r.out), r.out)
            assert.strict.ok(/缺 durations\(以平均值估算\): e2e-c\.test\.mjs/.test(r.out), r.out)
            assert.strict.equal(fs.existsSync(path.join(fx.root, 'tmp')), false, '--plan 不得建立任何東西')
            assert.strict.deepEqual(fx.records(), [])
            assert.strict.equal(runCliSync(fx, ['--instances', 'x']).code, 2)
            assert.strict.equal(runCliSync(fx, ['--nope']).code, 2)
            assert.strict.equal(runCliSync(fx, ['--ports']).code, 2)
        })

        it('[S-I4] --plan 之記憶體調降原因與不足警告以注入值驗', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok', c: 'ok' })
            let logs = []
            let r = await runShardedE2e({ root: fx.root, ports: [BASE], plan: true, instances: 3, availMemGb: 3.2, memPerInstanceGb: 1.5, log: (s) => logs.push(s) })
            assert.strict.equal(r.planned, true)
            assert.strict.equal(r.plan.instancesUsed, 2)
            assert.strict.ok(logs.some((l) => /調降實例數: 可用記憶體 3\.2 GB/.test(l)), logs.join('\n'))
            let logs2 = []
            let r2 = await runShardedE2e({ root: fx.root, ports: [BASE], plan: true, availMemGb: 0.2, log: (s) => logs2.push(s) })
            assert.strict.equal(r2.plan.instancesUsed, 1)
            assert.strict.ok(logs2.some((l) => /警告: 可用記憶體 0\.2 GB 不足 1 個實例/.test(l)), logs2.join('\n'))
        })

        it('[S-I5] 設定問題於動手前拋錯: 未知鍵、壞 JSON、未給 ports、跨組撞埠、溢位、找不到檔案; 皆未建立任何東西', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok' })
            let tmp = path.join(fx.root, 'tmp')
            let silent = { log: () => {} }
            let fpCfg = path.join(fx.root, 'test', 'tools', 'e2eShard.json')
            fs.writeFileSync(fpCfg, '{"officalOnly":[]}')
            await assert.rejects(runShardedE2e({ root: fx.root, ...silent }), /含未知之鍵: officalOnly/)
            fs.writeFileSync(fpCfg, '{bad')
            await assert.rejects(runShardedE2e({ root: fx.root, ...silent }), /無法解析/)
            fs.rmSync(fpCfg)
            await assert.rejects(runShardedE2e({ root: fx.root, availMemGb: 64, ...silent }), /未給 ports/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: 'x', ...silent }), /ports 須為基準埠陣列/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [70000], ...silent }), /不合法之埠: 70000/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE, BASE + 100], instances: 2, availMemGb: 64, ...silent }), /同時為第 0 組與第 1 組所用/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [65500], instances: 2, availMemGb: 64, ...silent }), /超過 65535/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE], officialOnly: ['e2e-x.test.mjs'], ...silent }), /officialOnly 含不存在之檔名/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE], testDir: 'none', ...silent }), /沒有 e2e-\*\.test\.mjs/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE], workDir: fx.root, ...silent }), /workDir 不可為專案根或其上層/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE], workDir: path.dirname(fx.root), ...silent }), /workDir 不可為專案根或其上層/)
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE], workDir: path.join(fx.root, 'node_modules', 'x'), ...silent }), /workDir 不可位於/)
            await assert.rejects(runShardedE2e({}), /root 為必填字串/)
            await assert.rejects(runShardedE2e({ root: path.join(fx.root, 'none') }), /root 不存在/)
            assert.strict.equal(fs.existsSync(tmp), false)
            assert.strict.deepEqual(fx.records(), [])
        })

        it('[S-I6] 只跑比對: E2E_REGEN=1 或 mochaArgs 含 --baseline 拋錯, 未建立任何東西; 專案未接線(無 resolveE2ePort)拋錯', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok' })
            let silent = { log: () => {}, availMemGb: 64, ports: [BASE] }
            process.env.E2E_REGEN = '1'
            try {
                await assert.rejects(runShardedE2e({ root: fx.root, ...silent }), /只跑比對/)
            }
            finally {
                delete process.env.E2E_REGEN
            }
            await assert.rejects(runShardedE2e({ root: fx.root, mochaArgs: ['--baseline'], ...silent }), /不可含 --baseline/)
            await assert.rejects(runShardedE2e({ root: fx.root, mochaArgs: ['--reporter', 'list'], ...silent }), /不可含 --reporter/)
            assert.strict.equal(fs.existsSync(path.join(fx.root, 'tmp')), false)
            let fx2 = mkFixture({ a: 'ok', b: 'ok' }, { noAdopt: true })
            await assert.rejects(runShardedE2e({ root: fx2.root, ...silent }), /未使用 resolveE2ePort 或 E2E_PORT_OFFSET/)
            assert.strict.equal(fs.existsSync(path.join(fx2.root, 'tmp')), false)
        })

    })

    describe('失敗與統計', function() {

        it('[S-I7] 一組失敗: 離開碼非 0、失敗標題列出、testPending 搬回不覆蓋、實例已移除', async function() {
            let fx = mkFixture({ a: 'ok', b: 'fail' })
            //正式專案已有同名證據: 不得覆蓋
            fs.mkdirSync(path.join(fx.root, 'testPending'), { recursive: true })
            let ev = 'flow-E2E-001__2026-11-04_07-00-00-000__capture.png'
            fs.writeFileSync(path.join(fx.root, 'testPending', ev), 'old')
            let { pm, logs } = await runApi(fx, { instances: 2 })
            let r = await pm
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.equal(r.totals.failing, 1)
            assert.strict.equal(r.totals.failures.length, 1)
            assert.strict.equal(r.totals.failures[0].title, 'b 巢狀 b 會失敗之案')
            assert.strict.equal(r.totals.failures[0].file, 'e2e-b.test.mjs')
            assert.strict.ok(logs.some((l) => /1\) \[第\d組 e2e-b\.test\.mjs\] b 巢狀 b 會失敗之案/.test(l)), logs.join('\n'))
            assert.strict.ok(logs.includes('  1 failing'))
            //testPending 已搬回
            assert.strict.equal(fs.readFileSync(path.join(fx.root, 'testPending', ev), 'utf8'), 'old')
            assert.strict.equal(fs.readFileSync(path.join(fx.root, 'testPending', 'flow-E2E-001__2026-11-04_07-00-00-000-1__capture.png'), 'utf8'), 'from-instance')
            assert.strict.ok(fs.existsSync(path.join(fx.root, 'testPending', 'flow-E2E-001__2026-11-04_07-00-00-000__collect.json')))
            //收尾
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I8] 統計判定: 測試層 root after 呼叫 process.exit(0) 而全部案例已跑 → 算跑完; 中途 process.exit(0) → 未跑完; 全過而 mocha 離開碼非 0 → 與統計不符; 後二者離開碼非 0', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok', c: 'ok' })
            //a: 全部跑完後 root after 同步強制結束, run end 不會發生(sso api-setup 之 registerForceExitOnce 為 setImmediate 版, 較寬鬆)
            let fp = path.join(fx.root, 'test', 'e2e-a.test.mjs')
            fs.appendFileSync(fp, '\nafter(function() {\n    process.exit(0)\n})\n')
            //b: 中途結束
            let fp2 = path.join(fx.root, 'test', 'e2e-b.test.mjs')
            fs.appendFileSync(fp2, '\ndescribe(\'b2\', function() {\n    it(\'中途結束\', function() {\n        process.exit(0)\n    })\n    it(\'跑不到\', function() {})\n})\n')
            //c: 全過但以非 0 結束
            let fp3 = path.join(fx.root, 'test', 'e2e-c.test.mjs')
            fs.appendFileSync(fp3, '\nafter(function() {\n    process.exit(3)\n})\n')
            let { pm, logs } = await runApi(fx, { instances: 3 })
            let r = await pm
            let g = Object.fromEntries(r.groups.map((v) => [v.files[0], v]))
            assert.strict.equal(g['e2e-a.test.mjs'].complete, true, JSON.stringify(g['e2e-a.test.mjs']))
            assert.strict.equal(g['e2e-b.test.mjs'].complete, false)
            assert.ok(/未跑完/.test(g['e2e-b.test.mjs'].note), g['e2e-b.test.mjs'].note)
            assert.strict.equal(g['e2e-c.test.mjs'].complete, false)
            assert.ok(/離開碼 3 與統計不符/.test(g['e2e-c.test.mjs'].note), g['e2e-c.test.mjs'].note)
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.deepEqual(r.totals.incomplete.slice().sort(), [g['e2e-b.test.mjs'].index, g['e2e-c.test.mjs'].index].sort())
            assert.strict.ok(logs.some((l) => /未跑完之組/.test(l)))
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I9] 沒有統計即離開碼非 0: 測試檔語法錯誤使 mocha 起不來', async function() {
            let fx = mkFixture({ a: 'ok' })
            fs.writeFileSync(path.join(fx.root, 'test', 'e2e-bad.test.mjs'), 'this is not javascript(')
            let { pm } = await runApi(fx, { instances: 1 })
            let r = await pm
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.equal(r.groups[0].complete, false)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I10] 空跑(0 案例)判為未跑完', async function() {
            let fx = mkFixture({ a: 'ok' })
            fs.writeFileSync(path.join(fx.root, 'test', 'e2e-a.test.mjs'), 'describe(\'empty\', function() {})\n')
            let { pm } = await runApi(fx, { ports: [] })
            let r = await pm
            assert.strict.notEqual(r.exitCode, 0)
            assert.ok(/空跑|未跑完/.test(r.groups[0].note), r.groups[0].note)
            assertInstancesGone(fx)
        })

        it('[S-I11] 每組逾時: 樹狀終止該組並判為未跑完, 他組不受影響', async function() {
            let fx = mkFixture({ a: 'gate', b: 'ok' })
            let { pm } = await runApi(fx, { instances: 2, durations: { 'e2e-a.test.mjs': 2, 'e2e-b.test.mjs': 1 }, groupTimeoutMs: 25000 })
            let r = await pm
            let g = Object.fromEntries(r.groups.map((v) => [v.files[0], v]))
            assert.strict.equal(g['e2e-a.test.mjs'].note, '逾時')
            //該組是被終止, 不是等到閘門逾時才自己失敗
            assert.strict.equal(g['e2e-a.test.mjs'].failing, 0)
            assert.strict.equal(g['e2e-b.test.mjs'].complete, true)
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.equal(await bindFree(BASE), true)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

    })

    describe('子行程被殺與終止訊號', function() {

        it('[S-I12] mocha 被硬殺、服務成孤兒: 孤兒被清、埠釋放、實例移除、目標完好、離開碼非 0', async function() {
            let fx = mkFixture({ a: 'hardkill', b: 'ok' })
            let { pm } = await runApi(fx, { instances: 2, durations: { 'e2e-a.test.mjs': 2, 'e2e-b.test.mjs': 1 } })
            let r = await pm
            let rec = fx.records().find((v) => v.file === 'a')
            assert.strict.equal(pidExists(rec.svcPid), false, '孤兒服務應已被終止')
            let g = r.groups.find((v) => v.files.includes('e2e-a.test.mjs'))
            assert.strict.equal(g.complete, false)
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.deepEqual(r.teardownErrors, [])
            assert.strict.equal(await bindFree(rec.port), true)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I13] 工具收到 SIGTERM(處理器路徑, 真子行程): 子行程樹與服務皆終止、實例移除、目標完好、離開碼 143', async function() {
            let fx = mkFixture({ a: 'gate', b: 'gate' })
            let proc = new EventEmitter()
            let { pm, logs } = await runApi(fx, { instances: 2, proc })
            await until(() => fx.records().length >= 2, '兩組都進入測試')
            let recs = fx.records()
            proc.emit('SIGTERM')
            proc.emit('SIGTERM') //重複訊號不得中斷收尾
            let r = await pm
            assert.strict.equal(r.exitCode, 143)
            assert.strict.equal(r.signal, 'SIGTERM')
            //子行程是被終止, 不是等到閘門逾時才自己結束: 各組皆未跑完、也沒有因逾時而失敗之案
            assert.strict.deepEqual(r.groups.map((g) => [g.complete, g.failing]), [[false, 0], [false, 0]])
            for (let rec of recs) {
                assert.strict.equal(pidExists(rec.mochaPid), false)
                assert.strict.equal(pidExists(rec.svcPid), false)
                assert.strict.equal(await bindFree(rec.port), true)
            }
            assert.strict.equal(proc.listenerCount('SIGTERM'), 0)
            assert.strict.ok(logs.some((l) => /收尾中/.test(l)))
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I14] 工具收到真實訊號(Windows 為主控台 Ctrl-Break→SIGBREAK; POSIX 為 SIGTERM): 實例移除、目標完好、離開碼 128＋訊號值', async function() {
            let fx = mkFixture({ a: 'gate' })
            let c = spawnCli(fx, ['--ports', String(BASE), '--instances', '1', '--progress-min', '60'])
            await until(() => fx.records().length >= 1, `進入測試; 輸出: ${c.out()}`)
            let rec = fx.records()[0]
            if (process.platform === 'win32') {
                //SetConsoleCtrlHandler(NULL) 只忽略 Ctrl-C, 送出者自身亦會被 Ctrl-Break 結束(0xC000013A), 代表事件已送達主控台
                assert.strict.ok([0, 0xC000013A].includes(sendConsoleEvent(c.child.pid, 1)), '送出主控台事件')
            }
            else {
                c.child.kill('SIGTERM')
            }
            let { code } = await c.closed
            assert.strict.equal(code, process.platform === 'win32' ? 149 : 143, c.out())
            assert.strict.ok(/收到 SIG(BREAK|TERM)/.test(c.out()), c.out())
            assert.strict.equal(pidExists(rec.svcPid), false)
            assert.strict.equal(await bindFree(rec.port), true)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I14b] 工具收到真實 SIGINT(Windows 為主控台 Ctrl-C; 啟動器先解除繼承之 Ctrl-C 停用): 實例移除、目標完好、離開碼 130', async function() {
            let fx = mkFixture({ a: 'gate' })
            let fpOut = path.join(fx.fdCase, 'cli.log')
            let child
            if (process.platform === 'win32') {
                //測試執行環境常以 CREATE_NEW_PROCESS_GROUP 起動, 其「停用 Ctrl-C」屬性會被子行程繼承: 由啟動器解除後再起 CLI
                let ps = `
${psKernel32}
[WSh.K]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
cmd /c "node ""${fpCli}"" --ports ${BASE} --instances 1 --progress-min 60 > ""${fpOut}"" 2>&1"
exit $LASTEXITCODE
`
                child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
                    cwd: fx.root,
                    stdio: 'ignore',
                    windowsHide: true,
                    env: { ...process.env, SHARD_FIX_RECORD: fx.fpRecord, SHARD_FIX_GATE: fx.fpGate },
                })
            }
            else {
                let fd = fs.openSync(fpOut, 'w')
                child = spawn(process.execPath, [fpCli, '--ports', String(BASE), '--instances', '1', '--progress-min', '60'], {
                    cwd: fx.root,
                    stdio: ['ignore', fd, fd],
                    env: { ...process.env, SHARD_FIX_RECORD: fx.fpRecord, SHARD_FIX_GATE: fx.fpGate },
                })
                fs.closeSync(fd)
            }
            let readOut = () => (fs.existsSync(fpOut) ? fs.readFileSync(fpOut, 'utf8') : '')
            await until(() => fx.records().length >= 1, '進入測試')
            let rec = fx.records()[0]
            if (process.platform === 'win32') {
                assert.strict.equal(sendConsoleEvent(child.pid, 0), 0, '送出主控台事件')
            }
            else {
                child.kill('SIGINT')
            }
            await until(() => /離開碼 130/.test(readOut()), `收尾完成; 輸出: ${readOut()}`)
            assert.strict.ok(/收到 SIGINT/.test(readOut()), readOut())
            assert.strict.equal(pidExists(rec.svcPid), false)
            assert.strict.equal(await bindFree(rec.port), true)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I15] 工具被硬殺(處理器來不及執行): 孤兒服務與實例殘留, 下次開跑接手已死之鎖、以鎖檔記下之 PID 殺孤兒、清掉殘留、目標完好、全綠', async function() {
            let fx = mkFixture({ a: 'gateShell' })
            let c = spawnCli(fx, ['--ports', String(BASE), '--instances', '1', '--progress-min', '60', '--tree-sample-ms', '200'])
            await until(() => fx.records().length >= 1, `進入測試; 輸出: ${c.out()}`)
            let rec = fx.records()[0]
            let fpLock = path.join(fx.workDir, 'shard.lock')
            //事件同步: 等取樣把服務之 PID 寫入鎖檔
            await until(() => {
                try {
                    return JSON.parse(fs.readFileSync(fpLock, 'utf8')).groups.some((g) => g.pid === rec.svcPid)
                }
                catch (err) {
                    return false
                }
            }, '取樣寫入鎖檔')
            assert.strict.equal(JSON.parse(fs.readFileSync(fpLock, 'utf8')).pid, c.child.pid)
            c.child.kill('SIGKILL')
            await c.closed
            assert.strict.equal(fs.existsSync(path.join(fx.workDir, 'inst0', 'proj')), true, '硬殺後實例殘留')
            assert.strict.equal(pidExists(rec.svcPid), true, '硬殺後服務成孤兒')
            fs.writeFileSync(fx.fpGate, 'open') //本次讓閘門直接放行
            let { pm, logs } = await runApi(fx, { instances: 1 })
            let r = await pm
            assert.strict.ok(logs.some((l) => /接手已死之鎖/.test(l)), logs.join('\n'))
            assert.strict.ok(logs.some((l) => /清除上次中斷之殘留實例/.test(l)), logs.join('\n'))
            assert.strict.equal(r.exitCode, 0, logs.join('\n'))
            assert.strict.equal(pidExists(rec.mochaPid), false)
            assert.strict.equal(pidExists(rec.svcPid), false, '孤兒服務應已被終止')
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

    })

    describe('殘留、鎖、預檢、連結', function() {

        it('[S-I16] 殘留實例(無鎖; 含 testPending 與 .env 副本): 開跑時依拆除程序清掉, 證據搬回、目標完好', async function() {
            let fx = mkFixture({ a: 'ok' })
            let dst = path.join(fx.workDir, 'inst7', 'proj')
            fs.mkdirSync(path.join(dst, 'test'), { recursive: true })
            fs.mkdirSync(path.join(dst, 'testPending'), { recursive: true })
            fs.writeFileSync(path.join(dst, '.env'), `SECRET=${SECRET}\n`)
            fs.writeFileSync(path.join(dst, 'testPending', 'stale__2026-11-04_07-00-00-000__capture.png'), 'stale-ev')
            fs.symlinkSync(path.join(fx.root, 'node_modules'), path.join(dst, 'node_modules'), 'junction')
            fs.symlinkSync(path.join(fx.root, 'test', 'pics'), path.join(dst, 'test', 'pics'), 'junction')
            let { pm, logs } = await runApi(fx, { instances: 1 })
            let r = await pm
            assert.strict.equal(r.exitCode, 0, logs.join('\n'))
            assert.strict.ok(logs.some((l) => /清除上次中斷之殘留實例.*inst7/.test(l)), logs.join('\n'))
            assert.strict.equal(fs.readFileSync(path.join(fx.root, 'testPending', 'stale__2026-11-04_07-00-00-000__capture.png'), 'utf8'), 'stale-ev')
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I17] 第二個同時執行者被鎖擋下(持有者存活); 已死之鎖可接手; 內容壞且放久之鎖可接手', async function() {
            let fx = mkFixture({ a: 'ok' })
            fs.mkdirSync(fx.workDir, { recursive: true })
            let fpLock = path.join(fx.workDir, 'shard.lock')
            let live = { pid: process.pid, procStartMs: Date.now() - Math.round(process.uptime() * 1000), startMs: Date.now(), groups: [] }
            fs.writeFileSync(fpLock, JSON.stringify(live))
            let silent = { log: () => {}, availMemGb: 64, ports: [BASE] }
            await assert.rejects(runShardedE2e({ root: fx.root, ...silent }), /已有執行者.*PID/)
            assert.strict.deepEqual(JSON.parse(fs.readFileSync(fpLock, 'utf8')), live) //未動他人之鎖
            assert.strict.equal(fs.existsSync(path.join(fx.workDir, 'inst0')), false)
            //PID 仍在但起始時間不符(PID 回收): 視為已死
            fs.writeFileSync(fpLock, JSON.stringify({ ...live, procStartMs: live.procStartMs - 3600000 }))
            let r1 = await (await runApi(fx, { instances: 1 })).pm
            assert.strict.equal(r1.exitCode, 0)
            assertInstancesGone(fx)
            //已死之 PID
            fs.mkdirSync(fx.workDir, { recursive: true })
            let dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8', windowsHide: true })
            fs.writeFileSync(fpLock, JSON.stringify({ pid: Number(dead.stdout.trim()), procStartMs: 0, startMs: 0, groups: [] }))
            let r2 = await (await runApi(fx, { instances: 1 })).pm
            assert.strict.equal(r2.exitCode, 0)
            assertInstancesGone(fx)
            //內容壞: 剛建立視為仍在
            fs.mkdirSync(fx.workDir, { recursive: true })
            fs.writeFileSync(fpLock, '')
            await assert.rejects(runShardedE2e({ root: fx.root, ...silent }), /已有執行者/)
            //內容壞且放久: 接手
            let old = new Date(Date.now() - 3600000)
            fs.utimesSync(fpLock, old, old)
            let r3 = await (await runApi(fx, { instances: 1 })).pm
            assert.strict.equal(r3.exitCode, 0)
            assertInstancesGone(fx)
            //接手守衛: 已死之鎖而守衛新鮮(另一執行者正在接手)→ 擋下; 守衛放久(接手者已死)→ 可接手
            fs.mkdirSync(fx.workDir, { recursive: true })
            let deadLock = JSON.stringify({ pid: Number(dead.stdout.trim()), procStartMs: 0, startMs: 0, groups: [] })
            fs.writeFileSync(fpLock, deadLock)
            let fpGuard = `${fpLock}.takeover`
            fs.writeFileSync(fpGuard, '1')
            await assert.rejects(runShardedE2e({ root: fx.root, ...silent }), /另一執行者正在接手/)
            assert.strict.equal(fs.readFileSync(fpLock, 'utf8'), deadLock) //未動鎖
            fs.utimesSync(fpGuard, old, old)
            let r4 = await (await runApi(fx, { instances: 1 })).pm
            assert.strict.equal(r4.exitCode, 0)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I18] 真實併發: 第一個執行中時第二個被擋, 第一個不受影響', async function() {
            let fx = mkFixture({ a: 'gate' })
            let { pm } = await runApi(fx, { instances: 1 })
            await until(() => fx.records().length >= 1, '進入測試')
            await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE], availMemGb: 64, log: () => {} }), /已有執行者/)
            fs.writeFileSync(fx.fpGate, 'open')
            let r = await pm
            assert.strict.equal(r.exitCode, 0)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        for (let [name, host] of [['127.0.0.1', '127.0.0.1'], ['0.0.0.0', '0.0.0.0'], ['::1', '::1']]) {
            it(`[S-I19] 預檢: 第 1 組之埠被占用(綁 ${name})時拋錯列出占用者, 不沿用、未建立任何實例`, async function() {
                let fx = mkFixture({ a: 'ok', b: 'ok' })
                let s = net.createServer()
                await new Promise((resolve, reject) => {
                    s.once('error', reject)
                    s.listen(BASE + 100, host, resolve)
                }).catch((err) => {
                    if (host === '::1') {
                        return this.skip()
                    }
                    throw err
                })
                try {
                    let err = await runShardedE2e({ root: fx.root, ports: [BASE], instances: 2, availMemGb: 64, log: () => {} }).then(() => null, (e) => e)
                    assert.ok(err, '應拋錯')
                    assert.strict.ok(/預檢失敗/.test(err.message), err.message)
                    assert.strict.ok(err.message.includes(String(BASE + 100)), err.message)
                    assert.strict.ok(err.message.includes(`PID ${process.pid}`), err.message)
                    assert.strict.equal(err.blocked.length, 1)
                    assert.strict.equal(err.blocked[0].group, 1)
                    assert.strict.equal(fs.existsSync(fx.workDir), false, '未建立任何實例且鎖已釋放')
                    assert.strict.deepEqual(fx.records(), [])
                }
                finally {
                    await new Promise((resolve) => s.close(resolve))
                }
            })
        }

        it('[S-I20] 來源樹有不允許之連結: 拋錯列出、未建立實例; exclude 該路徑即可通過', async function() {
            let fx = mkFixture({ a: 'ok' })
            let outer = path.join(fx.fdCase, 'outer')
            fs.mkdirSync(outer)
            fs.symlinkSync(outer, path.join(fx.root, 'src', 'lnk'), 'junction')
            let err = await runShardedE2e({ root: fx.root, ports: [BASE], instances: 1, availMemGb: 64, log: () => {} }).then(() => null, (e) => e)
            assert.ok(err)
            assert.strict.ok(/不允許之連結/.test(err.message) && err.message.includes('src/lnk'), err.message)
            assert.strict.equal(fs.existsSync(path.join(fx.workDir, 'inst0')), false)
            let { pm } = await runApi(fx, { instances: 1, exclude: ['src/lnk'] })
            let r = await pm
            assert.strict.equal(r.exitCode, 0)
            assert.strict.equal(fs.existsSync(path.join(fx.root, 'src', 'lnk')), true)
            assertInstancesGone(fx)
            fs.unlinkSync(path.join(fx.root, 'src', 'lnk'))
        })

        it('[S-I21] 測試改動 test/pics: 大聲報錯、離開碼非 0、實例保留待查; 復原後重跑清除', async function() {
            let fx = mkFixture({ a: 'ok' })
            fs.appendFileSync(path.join(fx.root, 'test', 'e2e-a.test.mjs'), '\nafter(function() {\n    fs.writeFileSync(\'test/pics/flow/evil.png\', \'x\')\n})\n')
            let { pm, logs } = await runApi(fx, { instances: 1 })
            let r = await pm
            assert.strict.notEqual(r.exitCode, 0)
            assert.strict.ok(r.teardownErrors.some((e) => /test\/pics 於本次執行中被改動.*evil\.png/.test(e)), r.teardownErrors.join('|'))
            assert.strict.ok(logs.some((l) => /收尾失敗/.test(l)))
            assert.strict.ok(logs.some((l) => /切勿直接遞迴刪除/.test(l)))
            assert.strict.equal(fs.existsSync(path.join(fx.workDir, 'inst0', 'proj')), true)
            //復原: 測試檔改回、移除寫入之圖, 重跑即清除殘留
            fs.rmSync(path.join(fx.root, 'test', 'pics', 'flow', 'evil.png'))
            fs.writeFileSync(path.join(fx.root, 'test', 'e2e-a.test.mjs'), fs.readFileSync(path.join(fx.root, 'test', 'e2e-a.test.mjs'), 'utf8').replace(/\nafter\(function\(\) \{\n {4}fs\.writeFileSync[^]*$/, '\n'))
            let r2 = await (await runApi(fx, { instances: 1 })).pm
            assert.strict.equal(r2.exitCode, 0)
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I22] 排除路徑: 預設排除項與 exclude 不進實例; 同名子夾(src/logs)不受影響', async function() {
            let fx = mkFixture({ a: 'ok' })
            fs.mkdirSync(path.join(fx.root, 'src', 'logs'), { recursive: true })
            fs.writeFileSync(path.join(fx.root, 'src', 'logs', 'keep.txt'), 'k')
            for (let d of ['docs', 'sgud', 'bigdata', '.git']) {
                fs.mkdirSync(path.join(fx.root, d), { recursive: true })
                fs.writeFileSync(path.join(fx.root, d, 'x.txt'), 'x')
            }
            fs.mkdirSync(path.join(fx.root, 'test', '_tmp'), { recursive: true })
            fs.writeFileSync(path.join(fx.root, 'test', '_tmp', 'x.txt'), 'x')
            //測試檔於實例內回報看到之內容
            fs.appendFileSync(path.join(fx.root, 'test', 'e2e-a.test.mjs'), `
describe('look', function() {
    it('看實例內容', function() {
        record({
            file: 'look',
            seen: ['docs', 'sgud', 'bigdata', '.git', 'test/_tmp', 'logs/huge.log'].filter((p) => fs.existsSync(p)),
            logsDir: fs.existsSync('logs'),
            kept: fs.existsSync('src/logs/keep.txt') && fs.existsSync('src/a.txt') && fs.existsSync('.env'),
            nmLink: fs.lstatSync('node_modules').isSymbolicLink(),
            picsLink: fs.lstatSync('test/pics').isSymbolicLink(),
            sentinel: fs.readFileSync('node_modules/__sentinel__/keep.txt', 'utf8'),
        })
    })
})
`)
            let r = await (await runApi(fx, { instances: 1, exclude: ['bigdata/'] })).pm
            assert.strict.equal(r.exitCode, 0)
            let look = fx.records().find((v) => v.file === 'look')
            assert.strict.deepEqual(look.seen, [])
            assert.strict.equal(look.logsDir, true)
            assert.strict.equal(look.kept, true)
            assert.strict.equal(look.nmLink, true)
            assert.strict.equal(look.picsLink, true)
            assert.strict.equal(look.sentinel, 'nm-sentinel')
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I23] 進度: 每 progressMs 印一行, 含即時案例數(以閘門同步, 收到進度行才放行)', async function() {
            let fx = mkFixture({ a: 'passThenGate' })
            let { pm, logs } = await runApi(fx, { instances: 1, progressMs: 200 })
            await until(() => logs.some((l) => /\[shard\] 進度 .*第0組 執行中 1\/2\(✘0\)/.test(l)), '進度行')
            fs.writeFileSync(fx.fpGate, 'open')
            let r = await pm
            assert.strict.equal(r.exitCode, 0)
            assertInstancesGone(fx)
        })

        it('[S-I25] 建立實例後才發生之例外: 仍依拆除程序清掉已建立之實例、目標完好、原錯誤拋出', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok' })
            //排除測試檔本身: 實例建立後發現缺檔
            let err = await runShardedE2e({
                root: fx.root,
                ports: [BASE],
                instances: 2,
                availMemGb: 64,
                exclude: ['test/e2e-b.test.mjs'],
                durations: { 'e2e-a.test.mjs': 2, 'e2e-b.test.mjs': 1 },
                log: () => {},
            }).then(() => null, (e) => e)
            assert.ok(err, '應拋錯')
            assert.strict.ok(/實例內缺測試檔.*e2e-b\.test\.mjs/.test(err.message), err.message)
            assert.strict.deepEqual(err.teardownErrors, [])
            assert.strict.deepEqual(fx.records(), [])
            assertInstancesGone(fx)
            assertTargetsIntact(fx)
        })

        it('[S-I24] 兩個基準埠皆位移; 第 1 組之第二埠被占用亦擋下', async function() {
            let fx = mkFixture({ a: 'ok', b: 'ok' })
            let s = net.createServer()
            await new Promise((resolve) => s.listen(BASE + 110, '127.0.0.1', resolve))
            try {
                await assert.rejects(runShardedE2e({ root: fx.root, ports: [BASE, BASE + 10], instances: 2, availMemGb: 64, log: () => {} }), /埠 19310\(基準 19210\+100\)/)
            }
            finally {
                await new Promise((resolve) => s.close(resolve))
            }
            assert.strict.equal(fs.existsSync(fx.workDir), false)
        })

    })

})


describe('findProcessDescendants', function() {

    let t = 1000000

    it('[S-P1] 根已結束: 依 ppid 找子孫(由深到淺), 不含無關行程', function() {
        let table = [
            { pid: 11, ppid: 10, startMs: t + 10 },
            { pid: 12, ppid: 11, startMs: t + 20 },
            { pid: 13, ppid: 12, startMs: t + 30 },
            { pid: 99, ppid: 1, startMs: t + 5 },
        ]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t }]), [13, 12, 11])
    })

    it('[S-P2] 根存活且身分相符: 含根; 根之 PID 被回收(起始時間不符): 不走其下', function() {
        let table = [{ pid: 10, ppid: 1, startMs: t }, { pid: 11, ppid: 10, startMs: t + 10 }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t + 1000 }]), [11, 10])
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t + 3600000 }]), [])
    })

    it('[S-P3] 早於父行程起始之「子」為 PID 回收造成之假關係, 不算', function() {
        let table = [{ pid: 11, ppid: 10, startMs: t - 3600000 }, { pid: 12, ppid: 10, startMs: t + 5 }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t }]), [12])
    })

    it('[S-P4] 環狀 ppid 不會無窮迴圈; 無根回空', function() {
        let table = [{ pid: 1, ppid: 2, startMs: t }, { pid: 2, ppid: 1, startMs: t }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 1, startMs: t }]).sort(), [1, 2])
        assert.strict.deepEqual(findProcessDescendants(table, []), [])
    })

})
