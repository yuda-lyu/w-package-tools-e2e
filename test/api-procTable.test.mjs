import fs from 'fs'
import assert from 'assert'
import { spawn, spawnSync } from 'child_process'
import reapShardProcesses, { listProcessTable, parseProcessTable, processTableCommand } from '../src/reapShardProcesses.mjs'
import pidExists from '../src/pidExists.mjs'
import { stopChild } from './tools/portOccupant.mjs'


//行程表取法之實機測試(帳本 sgud/rule/rulebook_port.md R-23): 真實行程表, 以獨立之舊查法(Get-CimInstance)為對照。下殺之身分判準不得因改法而放寬: PID、起始時間(毫秒)、父 PID、映像名須與舊法一致


//對照組: 舊查法(本檔獨立一份, 不經 src)
let CMD_CIM = 'Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { \'{0} {1} {2} {3}\' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().ToString(\'o\'), $_.Name } }'
let RUN = { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }


function cimTable() {
    let r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', CMD_CIM], RUN)
    assert.strict.equal(r.status, 0)
    return parseProcessTable(r.stdout)
}


//取出 src 之腳本(測試改寫之, 驗退回路徑)
function script() {
    let { args } = processTableCommand('win32')
    return Buffer.from(args[args.length - 1], 'base64').toString('utf16le')
}


let enc = (s) => Buffer.from(s, 'utf16le').toString('base64')
let viaOf = (stdout) => (/WE2E-PROCTABLE-VIA (\w+)/.exec(stdout) || [])[1]


function runScript(s, exe = 'powershell') {
    let r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc(s)], RUN)
    return { status: r.status, via: viaOf(r.stdout), rows: parseProcessTable(r.stdout) }
}


//同一時段之比對: 雙方皆有之 PID 欄位須完全相同; 只出現於一方者只能是查詢當下才起或才結束之短命行程
function assertSameAsCim(rows, label) {
    let cim = cimTable()
    let mc = new Map(cim.map((p) => [p.pid, p]))
    let both = rows.filter((p) => mc.has(p.pid))
    assert.ok(both.length >= 50, `${label}: 共同行程過少 ${both.length}`)
    assert.ok(both.length >= Math.min(rows.length, cim.length) * 0.9, `${label}: 列數差異過大 新 ${rows.length} 舊 ${cim.length} 共同 ${both.length}`)
    for (let p of both) {
        let c = mc.get(p.pid)
        assert.strict.deepEqual({ pid: p.pid, ppid: p.ppid, startMs: p.startMs, image: p.image }, { pid: c.pid, ppid: c.ppid, startMs: c.startMs, image: c.image }, `${label}: PID ${p.pid}`)
    }
}


describe('行程表取法實機', function() {

    this.timeout(180000)

    //本檔只針對 Windows 之取法; 其他平台明示略過, 不靜默消失
    before(function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
    })

    //規格句: 輸出欄位與語意不變; 精度要實測與舊法一致
    it('[PT1] 與舊查法逐筆相同(連 3 輪): PID、父 PID、起始時間(毫秒)、映像名', function() {
        for (let i = 0; i < 3; i++) {
            assertSameAsCim(listProcessTable(), `第 ${i + 1} 輪`)
        }
    })

    it('[PT2] 正常時走作業系統 API; 標記行不進資料', function() {
        let { prog, args } = processTableCommand('win32')
        let r = spawnSync(prog, args, RUN)
        assert.strict.equal(r.status, 0)
        assert.strict.equal(viaOf(r.stdout), 'api')
        let rows = parseProcessTable(r.stdout)
        assert.ok(rows.length >= 50 && rows.every((p) => Number.isInteger(p.pid) && Number.isInteger(p.ppid) && Number.isFinite(p.startMs)))
    })

    it('[PT3] 本行程之列: PID、父 PID、映像名正確, 起始時間與本行程相符', function() {
        let row = listProcessTable().find((p) => p.pid === process.pid)
        assert.ok(row)
        assert.strict.equal(row.ppid, process.ppid)
        assert.strict.equal(row.image, 'node.exe')
        assert.ok(Math.abs(row.startMs - (Date.now() - process.uptime() * 1000)) < 5000)
    })

    //規格句: Add-Type 失敗退回現行查法(受限語言模式下 Add-Type 與 Reflection.Emit 皆不可用; 真實引擎)
    it('[PT4] 受限語言模式: 退回 Get-CimInstance, 結果與舊查法相同', function() {
        let cmd = `$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${enc(script())}')); Import-Module CimCmdlets; $ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'; Invoke-Expression $s`
        let r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], RUN)
        assert.strict.equal(r.status, 0)
        assert.strict.equal(viaOf(r.stdout), 'cim')
        assertSameAsCim(parseProcessTable(r.stdout), '受限語言模式')
    })

    //規格句: 下殺之身分判準不得放寬: 讀錯欄位時不得拿錯的值去比對身分
    for (let [label, from, to] of [
        ['起始時間位移', 'ReadInt64($p, 0x20)', 'ReadInt64($p, 0x28)'],
        ['PID 位移', '$oPid = if ($x64) { 0x50 }', '$oPid = if ($x64) { 0x58 }'],
        ['映像名位移', '$oBuf = if ($x64) { 0x40 }', '$oBuf = if ($x64) { 0x48 }'],
    ]) {
        it(`[PT5] 欄位配置不符(${label}): 自我核對不過, 退回 Get-CimInstance, 結果仍正確`, function() {
            let s = script()
            assert.ok(s.includes(from), from)
            let r = runScript(s.replace(from, to))
            assert.strict.equal(r.status, 0)
            assert.strict.equal(r.via, 'cim')
            assertSameAsCim(r.rows, label)
        })
    }

    it('[PT5b] API 回錯誤(資訊類別不合法): 退回 Get-CimInstance, 結果仍正確', function() {
        let s = script()
        let from = 'NtQuerySystemInformation(5, $buf'
        assert.ok(s.includes(from))
        let r = runScript(s.replace(from, 'NtQuerySystemInformation(9999, $buf'))
        assert.strict.equal(r.status, 0)
        assert.strict.equal(r.via, 'cim')
        assertSameAsCim(r.rows, 'API 回錯誤')
    })

    it('[PT5c] 緩衝不足: 放大重取後仍走 API, 結果相同', function() {
        let s = script()
        let from = '$size = 1048576;'
        assert.ok(s.includes(from))
        let r = runScript(s.replace(from, '$size = 4096;'))
        assert.strict.equal(r.via, 'api')
        assertSameAsCim(r.rows, '緩衝不足')
    })

    it('[PT6] 32 位元 PowerShell: 同一腳本走 API, 結果相同', function() {
        let exe = 'C:/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
        if (!fs.existsSync(exe)) {
            this.skip()
        }
        let r = runScript(script(), exe)
        assert.strict.equal(r.via, 'api')
        assertSameAsCim(r.rows, 'x86')
    })

    //規格句: 下殺之身分判準不得放寬: 真實行程以新表之起始時間走真實下殺(同一 handle 上比對 .NET 之起始時間, 毫秒須相同)
    it('[PT7] 真實下殺: 新表之起始時間與 .NET 之起始時間毫秒相同(identity 成立); 差 1 毫秒即不殺', async function() {
        let child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true })
        try {
            await new Promise((resolve) => setTimeout(resolve, 300))
            let row = listProcessTable().find((p) => p.pid === child.pid)
            assert.ok(row)
            assert.strict.equal(row.ppid, process.pid)
            //差 1 毫秒: 身分不符, 不殺
            let wrong = reapShardProcesses({ known: [{ pid: row.pid, startMs: row.startMs + 1 }], phase: 'pt7' })
            assert.strict.deepEqual(wrong.kills, [])
            assert.strict.equal(pidExists(child.pid), true)
            //完全相同: 依 identity 下殺
            //其子孫(主控台程式之 conhost.exe)依 chain 一併收掉; 本案只看根
            let r = reapShardProcesses({ known: [{ pid: row.pid, startMs: row.startMs }], phase: 'pt7' })
            let rec = r.kills.find((v) => v.pid === child.pid)
            assert.strict.deepEqual([rec.basis, rec.result], ['identity', 'killed'])
            assert.ok(r.kills.filter((v) => v.pid !== child.pid).every((v) => v.basis === `chain:${child.pid}`), JSON.stringify(r.kills))
            assert.strict.equal(pidExists(child.pid), false)
        }
        finally {
            stopChild(child)
        }
    })

    //子孫走訪(chain)依父 PID 與起始時間: 新表之欄位要能走出真實行程鏈
    it('[PT8] 真實父子鏈: 由新表走得到孫行程(chain), 只殺鏈上', async function() {
        let code = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(c.pid);setInterval(()=>{},1000)`
        let child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
        let bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true })
        try {
            let gpid = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(Number(String(d).trim()))))
            await new Promise((resolve) => setTimeout(resolve, 300))
            let row = listProcessTable().find((p) => p.pid === child.pid)
            let r = reapShardProcesses({ known: [{ pid: row.pid, startMs: row.startMs }], phase: 'pt8' })
            let by = new Map(r.kills.map((v) => [v.pid, v]))
            assert.strict.deepEqual([by.get(child.pid).basis, by.get(child.pid).result], ['identity', 'killed'])
            assert.strict.deepEqual([by.get(gpid).basis, by.get(gpid).result], [`chain:${child.pid}`, 'killed'])
            assert.strict.equal(by.has(bystander.pid), false, '鏈外不在下殺清單')
            assert.strict.equal(pidExists(bystander.pid), true, '鏈外不動')
        }
        finally {
            stopChild(child)
            stopChild(bystander)
        }
    })

})
