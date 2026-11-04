import { spawnSync } from 'child_process'
import listenerPids from './listenerPids.mjs'


let BASIS_IDENTITY = 'identity'
let PS_TABLE = 'Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { \'{0} {1} {2} {3}\' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().ToString(\'o\'), $_.Name } }'


//預設執行函數(spawnSync形, 同 killPortListeners 之 opt.exec): 不經 shell、隱藏視窗、帶逾時
function execDef(prog, args, { timeout, maxBuffer }) {
    return spawnSync(prog, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout, maxBuffer, windowsHide: true })
}


//PID 之映像名稱(只取名稱, 不取命令列: 命令列可能含憑證)
function procName(pid, ctx = {}) {
    let run = ctx.exec || execDef
    try {
        if (process.platform === 'win32') {
            let r = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { src: 'tasklist', timeout: 10000, maxBuffer: 1024 * 1024 })
            let m = /^"([^"]+)"/.exec(String(r.stdout || '').trim())
            return m ? m[1] : ''
        }
        let r = run('ps', ['-o', 'comm=', '-p', String(pid)], { src: 'tasklist', timeout: 10000, maxBuffer: 1024 * 1024 })
        return String(r.stdout || '').trim()
    }
    catch (err) {
        return ''
    }
}


/**
 * 列出埠之占用者字串：PID與映像名稱，不取命令列(命令列可能含憑證)
 *
 * @param {Number} port 輸入埠
 * @param {Object} [ctx={}] 輸入設定物件，預設{}
 * @param {Function} [ctx.exec] 輸入同步執行子指令函數(與child_process.spawnSync同形)，預設為不經shell、隱藏視窗之spawnSync
 * @returns {String} 回傳占用者字串，查詢失敗或查無監聽者時回傳說明文字
 * @example
 *
 * import { describePortOwners } from 'w-package-tools-e2e/src/reapShardProcesses.mjs'
 *
 * console.log(describePortOwners(8080))
 * // => 'PID 1234 node.exe'
 *
 */
export function describePortOwners(port, ctx = {}) {
    let pids = listenerPids(port, { useBoth: true, timeout: 5000, exec: ctx.exec })
    if (pids === null) {
        return '占用者查詢失敗'
    }
    if (pids.length === 0) {
        return '查無監聽者(可能為保留埠或非監聽之占用)'
    }
    return pids.map((pid) => {
        let name = procName(pid, ctx)
        return `PID ${pid}${name ? ` ${name}` : ''}`
    }).join(', ')
}


//以 UTF-16 編碼傳 PowerShell 腳本: 免引號與非 ASCII 路徑之跳脫問題
function psArgs(script) {
    return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
}


//取行程表之指令
export function processTableCommand(platform = process.platform) {
    return platform === 'win32'
        ? { prog: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', PS_TABLE] }
        : { prog: 'ps', args: ['-A', '-o', 'pid=,ppid=,lstart=,comm='] }
}


//解析取行程表指令之輸出; 查無任何行程回傳 null
export function parseProcessTable(stdout, platform = process.platform) {
    let win = platform === 'win32'
    let re = win ? /^(\d+) (\d+) (\S+) ?(.*)$/ : /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s*(.*)$/
    let rows = String(stdout || '').split(/\r?\n/).map((l) => {
        let m = re.exec(win ? l.trim() : l)
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), startMs: Date.parse(m[3]), image: m[4].trim() } : null
    }).filter((v) => v && Number.isFinite(v.startMs))
    return rows.length > 0 ? rows : null
}


/**
 * 取行程表：PID、父PID、起始時間與映像名，不取命令列(命令列可能含憑證)
 *
 * Windows之CreationDate同一行程每次相同(2026-11-04實測全部行程5次查詢1256筆比對0差異)，故可作身分比對；其他平台之lstart為秒級
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Function} [opt.exec] 輸入同步執行子指令函數，格式為(prog, args, { src, timeout, maxBuffer })=>{ status, stdout, error }(與child_process.spawnSync同形)，src為'table'，預設為不經shell、隱藏視窗之spawnSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，預設process.platform
 * @returns {Array|null} 回傳行程陣列，元素為{pid,ppid,startMs,image}；查詢失敗或查無任何行程回傳null(呼叫端不得把null當成無行程)
 * @example
 *
 * import { listProcessTable } from 'w-package-tools-e2e/src/runShardedE2e.mjs'
 *
 * let table = listProcessTable()
 * console.log(table.find((p) => p.pid === process.pid).image)
 * // => 'node.exe'
 *
 */
export function listProcessTable(opt = {}) {
    let { exec, platform = process.platform } = opt
    let run = exec || execDef
    let o = { src: 'table', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }
    let { prog, args } = processTableCommand(platform)
    let r
    try {
        r = run(prog, args, o)
    }
    catch (err) {
        return null
    }
    if (!r || r.error || r.status !== 0) {
        return null
    }
    return parseProcessTable(r.stdout, platform)
}


//身分鍵: PID 與起始時間皆須完全相同
export let keyOf = (p) => `${Number(p.pid)}@${p.startMs}`


//由種子沿存活之父子鏈走訪: 父自起始至今持續持有該 PID, 此期間建立且 ppid 為該 PID 者必為其子; 起始較早者為 PID 回收造成之假關係。回傳由深到淺
export function walkLiveTree(table, seeds, protect = new Set()) {
    let found = new Map()
    let queue = []
    for (let { row, basis } of seeds) {
        if (!found.has(row.pid) && !protect.has(row.pid)) {
            let v = { row, basis, depth: 0 }
            found.set(row.pid, v)
            queue.push(v)
        }
    }
    while (queue.length > 0) {
        let p = queue.shift()
        for (let c of table) {
            if (c.ppid === p.row.pid && c.pid !== p.row.pid && !found.has(c.pid) && !protect.has(c.pid) && c.startMs >= p.row.startMs) {
                let v = { row: c, basis: `chain:${p.row.pid}`, depth: p.depth + 1 }
                found.set(c.pid, v)
                queue.push(v)
            }
        }
    }
    return [...found.values()].sort((a, b) => b.depth - a.depth)
}


/**
 * 由行程表找出身分已確認且仍存活之根行程，及沿存活父子鏈走到之全部子孫
 *
 * 根須PID相同且起始時間與紀錄完全相同；已結束之根不走其下：Windows之ParentProcessId於父結束後仍留在子行程上，且PID會回收，
 * 「父已結束＋ppid相同＋起始較晚」不足以判定為子孫(2026-11-04疑似誤殺他套件派工之成因)。子孫須起始不早於其存活之父
 *
 * @param {Array} table 輸入行程表陣列，元素為{pid,ppid,startMs}
 * @param {Array} roots 輸入根行程陣列，元素為{pid,startMs}
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.protect=[]] 輸入不納入且不往下走之PID陣列，預設[]
 * @returns {Array} 回傳PID數字陣列(含身分相符之根，由子孫往根排序)
 * @example
 *
 * import { findProcessDescendants } from 'w-package-tools-e2e/src/runShardedE2e.mjs'
 *
 * let table = [{ pid: 10, ppid: 1, startMs: 100 }, { pid: 11, ppid: 10, startMs: 110 }]
 * console.log(findProcessDescendants(table, [{ pid: 10, startMs: 100 }]))
 * // => [11, 10]
 *
 */
export function findProcessDescendants(table, roots, opt = {}) {
    let keys = new Set(roots.map(keyOf))
    let seeds = table.filter((row) => keys.has(keyOf(row))).map((row) => ({ row, basis: BASIS_IDENTITY }))
    return walkLiveTree(table, seeds, new Set(opt.protect || [])).map((v) => v.row.pid)
}


/**
 * 取樣：依行程表更新已確認身分之行程清單
 *
 * 只保留仍存活且身分相符者(已結束者之紀錄日後不可能再相符)，並加入沿存活父子鏈走到之新子孫；父已結束者一律不納入，避免把誤認寫進清單
 *
 * @param {Array} table 輸入行程表陣列，元素為{pid,ppid,startMs,image}
 * @param {Array} known 輸入已確認身分之行程陣列，元素為{pid,startMs,image}
 * @returns {Object} 回傳物件{known,added,dropped}，known為更新後之陣列，added、dropped為新增與移除筆數
 * @example
 *
 * import { sampleShardKnown } from 'w-package-tools-e2e/src/runShardedE2e.mjs'
 *
 * let table = [{ pid: 10, ppid: 1, startMs: 100, image: 'a' }, { pid: 11, ppid: 10, startMs: 110, image: 'b' }]
 * console.log(sampleShardKnown(table, [{ pid: 10, startMs: 100, image: 'a' }]).added)
 * // => 1
 *
 */
export function sampleShardKnown(table, known) {
    let keys = new Set(known.map(keyOf))
    let seeds = table.filter((row) => keys.has(keyOf(row))).map((row) => ({ row, basis: BASIS_IDENTITY }))
    let next = walkLiveTree(table, seeds).map((v) => ({ pid: v.row.pid, startMs: v.row.startMs, image: v.row.image || '' }))
    let nextKeys = new Set(next.map(keyOf))
    return {
        known: next,
        added: next.filter((k) => !keys.has(keyOf(k))).length,
        dropped: [...keys].filter((k) => !nextKeys.has(k)).length,
    }
}


//本行程與祖先鏈: 祖先須起始不晚於其子, 否則為 PID 回收之假關係而停止往上(停在父已結束處)
function protectedPids(table, selfPid, parentPid) {
    let set = new Set([selfPid, parentPid].filter((v) => Number.isInteger(v)))
    let byPid = new Map(table.map((p) => [p.pid, p]))
    let cur = byPid.get(selfPid)
    while (cur) {
        let par = byPid.get(cur.ppid)
        if (!par || par.pid === cur.pid || par.startMs > cur.startMs) {
            break
        }
        set.add(par.pid)
        cur = par
    }
    return set
}


//下殺已確認身分之行程(不帶 /T: 子孫已自行走訪、逐筆留紀錄)。Windows 先取 handle 釘住行程再比對起始時間, 比對與下殺之間 PID 不可能被回收。回傳 Map(pid → 結果)
function killIdentified(rows, ctx = {}) {
    let { exec, platform = process.platform } = ctx
    let run = exec || execDef
    let targets = rows.map((r) => ({ pid: r.pid, startMs: r.startMs }))
    let res = new Map()
    if (platform === 'win32') {
        let list = rows.map((r) => `'${r.pid}|${new Date(r.startMs).toISOString()}'`).join(',')
        let script = [
            `foreach ($t in @(${list})) {`,
            '  $a = $t.Split(\'|\'); $id = [int]$a[0]; $p = $null',
            '  try { $p = [Diagnostics.Process]::GetProcessById($id) } catch { "$id gone"; continue }',
            '  try {',
            '    $null = $p.Handle',
            '    $s = $p.StartTime.ToUniversalTime().ToString(\'yyyy-MM-ddTHH:mm:ss.fffZ\', [Globalization.CultureInfo]::InvariantCulture)',
            '    if ($s -ne $a[1]) { "$id mismatch"; continue }',
            '    $p.Kill()',
            '    if ($p.WaitForExit(5000)) { "$id killed" } else { "$id pending" }',
            '  } catch { "$id error" }',
            '}',
        ].join('\n')
        let r
        try {
            r = run('powershell', psArgs(script), { src: 'kill', targets, timeout: 60000, maxBuffer: 1024 * 1024 })
        }
        catch (err) {
            r = null
        }
        if (r && !r.error && r.status === 0) {
            for (let l of String(r.stdout || '').split(/\r?\n/)) {
                let m = /^(\d+) (\w+)$/.exec(l.trim())
                if (m) {
                    res.set(Number(m[1]), m[2])
                }
            }
        }
        rows.forEach((v) => {
            if (!res.has(v.pid)) {
                res.set(v.pid, 'exec-failed')
            }
        })
        return res
    }
    for (let v of rows) {
        let r
        try {
            r = run('sh', ['-c', 'kill -9 "$1"', 'sh', String(v.pid)], { src: 'kill', targets: [{ pid: v.pid, startMs: v.startMs }], timeout: 15000, maxBuffer: 1024 * 1024 })
        }
        catch (err) {
            r = null
        }
        res.set(v.pid, r && !r.error && r.status === 0 ? 'killed' : 'exec-failed')
    }
    return res
}


//下殺紀錄之一筆
export function mkKillRecord(row, basis, phase, result) {
    return {
        pid: row.pid,
        image: row.image || '',
        startMs: Number.isFinite(row.startMs) ? row.startMs : null,
        start: Number.isFinite(row.startMs) ? new Date(row.startMs).toISOString() : '',
        basis,
        phase,
        result,
    }
}


//紀錄之輸出列
export function fmtKillRecord(rec) {
    return `[shard] 下殺 PID ${rec.pid} ${rec.image || '(映像名未知)'} 起始 ${rec.start || '(未知)'} 依據 ${rec.basis} 階段 ${rec.phase} 結果 ${rec.result}`
}


/**
 * 清理一次執行留下之行程：只殺身分已正面確認者，每筆留紀錄
 *
 * 可下殺者：①PID與起始時間皆與存活時之紀錄完全相同(依據identity)；②由身分已確認之存活行程沿存活父子鏈走到之子孫(依據chain:<父PID>)。
 * 其餘一律不殺：沒有行程表、未曾被取樣之孤兒、舊紀錄之PID已被回收皆然。本行程與祖先鏈永不下殺，亦不經其往下走。
 * 未曾被取樣之孤兒無從辨識(不讀其他行程之環境區塊與工作目錄)，父已結束且起始不早於since者與extra所列之監聽者只記入skipped。
 * 下殺不帶/T；Windows於同一handle上比對起始時間後才終止。
 *
 * @param {Object} opt 輸入設定物件
 * @param {Array} [opt.known=[]] 輸入存活時記下之行程陣列，元素為{pid,startMs}
 * @param {Number} [opt.since] 輸入起始時間下限毫秒數，父已結束且起始不早於此者記入skipped；未給不記
 * @param {Array} [opt.extra=[]] 輸入額外須判定之行程陣列，元素為{pid,port}(仍占埠之監聽者)，身分未確認者另記警告
 * @param {Array} [opt.only] 輸入只下殺之PID數字陣列，給定時身分已確認者中只殺此陣列所列，未給不限
 * @param {String} [opt.phase=''] 輸入階段字串，寫入紀錄
 * @param {Function} [opt.exec] 輸入同步執行子指令函數(與child_process.spawnSync同形)，src為'table'、'kill'(後者另帶targets)，預設為不經shell、隱藏視窗之spawnSync
 * @param {String} [opt.platform=process.platform] 輸入作業系統字串，預設process.platform
 * @param {Number} [opt.selfPid=process.pid] 輸入本行程PID，預設process.pid
 * @param {Number} [opt.parentPid=process.ppid] 輸入本行程之父PID，預設process.ppid
 * @param {Function} [opt.log] 輸入輸出函數，預設不輸出
 * @returns {Object} 回傳物件{tableOk,kills,skipped}，kills元素為{pid,image,startMs,start,basis,phase,result}，skipped元素為{pid,image,startMs,start,reason,phase,port}，reason為'protected'、'no-evidence'
 * @example
 *
 * import { reapShardProcesses } from 'w-package-tools-e2e/src/runShardedE2e.mjs'
 *
 * let r = reapShardProcesses({ known: [{ pid: 1234, startMs: 1793319707455 }], phase: 'teardown', log: console.log })
 * console.log(r.kills.map((v) => v.basis))
 * // => ['identity']
 *
 */
export function reapShardProcesses(opt = {}) {
    let { known = [], since, extra = [], only, phase = '', exec, platform = process.platform, selfPid = process.pid, parentPid = process.ppid, log = () => {} } = opt
    let ctx = { exec, platform }
    let kills = []
    let skipped = []
    let table = listProcessTable(ctx)
    if (table === null) {
        log(`[shard] 警告: 取行程表失敗(階段 ${phase}), 無法確認身分, 一律不下殺; 由回驗埠與刪實例把關`)
        return { tableOk: false, kills, skipped }
    }
    let skip = (row, reason, port) => {
        skipped.push({ ...mkKillRecord(row, '', phase, ''), reason, ...(port ? { port } : {}) })
    }
    let protect = protectedPids(table, selfPid, parentPid)
    let keys = new Set(known.map(keyOf))
    let identified = table.filter((row) => keys.has(keyOf(row)))
    for (let row of identified.filter((v) => protect.has(v.pid))) {
        skip(row, 'protected')
        log(`[shard] 警告: PID ${row.pid} ${row.image || ''} 為本行程或其祖先, 不下殺`)
    }
    let seeds = identified.map((row) => ({ row, basis: BASIS_IDENTITY }))
    let tree = walkLiveTree(table, seeds, protect)

    //身分未確認者: 父已結束之候選與仍占埠之監聽者, 一律不下殺
    let inTree = new Set(tree.map((v) => v.row.pid))
    let byPid = new Map(table.map((p) => [p.pid, p]))
    let isOrphan = (row) => {
        //非 Windows: 父結束後由 init(PID 1)收養
        if (platform !== 'win32' && row.ppid === 1) {
            return true
        }
        let par = byPid.get(row.ppid)
        return !par || par.startMs > row.startMs
    }
    let cands = Number.isFinite(since)
        ? table.filter((row) => row.startMs >= since && !protect.has(row.pid) && !inTree.has(row.pid) && isOrphan(row))
        : []
    let portOf = new Map()
    for (let e of extra) {
        let row = byPid.get(Number(e.pid))
        if (!row || inTree.has(row.pid)) {
            continue
        }
        if (protect.has(row.pid)) {
            skip(row, 'protected', e.port)
            continue
        }
        portOf.set(row.pid, e.port)
        if (!cands.includes(row)) {
            cands.push(row)
        }
    }
    for (let row of cands) {
        skip(row, 'no-evidence', portOf.get(row.pid))
        if (portOf.has(row.pid)) {
            log(`[shard] 警告: 埠 ${portOf.get(row.pid)} 之監聽者 PID ${row.pid} ${row.image || ''} 無身分證據, 不下殺`)
        }
    }
    let nOther = skipped.filter((v) => v.phase === phase && v.reason !== 'protected' && !v.port).length
    if (nOther > 0) {
        log(`[shard] 父已結束而無身分證據、未下殺之行程 ${nOther} 個(多為他人之行程; 未曾被取樣之孤兒無從辨識; 清單見 summary.json 之 killSkipped)`)
    }
    let list = only ? tree.filter((v) => only.includes(v.row.pid)) : tree
    if (list.length === 0) {
        return { tableOk: true, kills, skipped }
    }
    let results = killIdentified(list.map((v) => v.row), ctx)
    for (let v of list) {
        let rec = mkKillRecord(v.row, v.basis, phase, results.get(v.row.pid) || 'exec-failed')
        kills.push(rec)
        log(fmtKillRecord(rec))
    }
    return { tableOk: true, kills, skipped }
}


export default reapShardProcesses
