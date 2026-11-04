import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import {
    findProcessDescendants,
    sampleShardKnown,
    listProcessTable,
    reapShardProcesses
} from '../src/runShardedE2e.mjs'


//分組多開之行程身分判定(不變式: 未經正面確認身分之行程一律不殺; 規格見 sgud/rule/rulebook_shard.md S-V*)。
//全部以注入之行程表與注入之下殺函數驗證, 本檔不會對任何真實行程下殺, 故變異測試只跑本檔與 api-shardKillIdentity。


let T0 = Date.parse('2026-11-04T14:00:00.000Z')
//本行程與祖先鏈: 7000 ← 6000 ← 5000
let SELF = [
    { pid: 5000, ppid: 1, startMs: T0 - 300000, image: 'explorer.exe' },
    { pid: 6000, ppid: 5000, startMs: T0 - 200000, image: 'bash.exe' },
    { pid: 7000, ppid: 6000, startMs: T0 - 100000, image: 'node.exe' },
]
let SELF_OPT = { selfPid: 7000, parentPid: 6000, platform: 'win32' }

//事故之表: known 含已結束之 PID 41000; 暫態 bash 曾用過 41000 後結束, 現存 nohup(ppid=41000, 起始較晚) → node → claude → bash → node
let DEAD_P = 41000
let VICTIMS = [
    { pid: 52000, ppid: DEAD_P, startMs: T0 + 600000, image: 'nohup.exe' },
    { pid: 52004, ppid: 52000, startMs: T0 + 600100, image: 'node.exe' },
    { pid: 52008, ppid: 52004, startMs: T0 + 600200, image: 'claude.exe' },
    { pid: 52012, ppid: 52008, startMs: T0 + 600300, image: 'bash.exe' },
    { pid: 52016, ppid: 52012, startMs: T0 + 600400, image: 'node.exe' },
]


//注入之 spawnSync 形執行函數: 查表、下殺皆只記錄, 不碰真實行程; 未預期之 src 拋錯(不靜默略過; 不得再有讀其他行程環境區塊之呼叫)
function fakeExec(o = {}) {
    let { table = [], tableFail = false, killFail = false, killResult = 'killed' } = o
    let calls = { table: 0, kill: [] }
    let exec = (prog, args, opt) => {
        if (opt.src === 'table') {
            calls.table++
            if (tableFail) {
                return { status: null, stdout: '', error: new Error('fake table fail') }
            }
            return { status: 0, stdout: table.map((r) => `${r.pid} ${r.ppid} ${new Date(r.startMs).toISOString()} ${r.image || 'x.exe'}`).join('\r\n') }
        }
        if (opt.src === 'kill') {
            calls.kill.push({ prog, args, targets: opt.targets })
            if (killFail) {
                return { status: 1, stdout: '' }
            }
            return { status: 0, stdout: opt.targets.map((t) => `${t.pid} ${killResult}`).join('\r\n') }
        }
        throw new Error(`未預期之 src: ${opt.src}`)
    }
    return { exec, calls }
}

let killedPids = (calls) => calls.kill.flatMap((c) => c.targets.map((t) => t.pid))
let decodePs = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')


describe('findProcessDescendants', function() {

    let t = 1000000

    //原 [S-P1] 斷言「根已結束時依 ppid 找子孫」: 這正是誤認之機制(已結束父之 PID 會回收, 仍留在子之 ParentProcessId), 語意改為不走其下
    it('[S-P1] 根已結束: 不走其下, 回空', function() {
        let table = [
            { pid: 11, ppid: 10, startMs: t + 10 },
            { pid: 12, ppid: 11, startMs: t + 20 },
            { pid: 13, ppid: 12, startMs: t + 30 },
            { pid: 99, ppid: 1, startMs: t + 5 },
        ]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t }]), [])
    })

    //原 [S-P2] 容許 1 秒差: 容差改為 0(CreationDate 同一行程每次相同)
    it('[S-P2] 根存活且起始時間完全相同: 含根(由深到淺); 差 1 毫秒即視為 PID 回收, 不走其下', function() {
        let table = [{ pid: 10, ppid: 1, startMs: t }, { pid: 11, ppid: 10, startMs: t + 10 }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t }]), [11, 10])
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t + 1 }]), [])
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t - 1 }]), [])
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t + 3600000 }]), [])
    })

    //原 [S-P3] 根已結束仍走; 改為根存活時才走, 假關係仍不算
    it('[S-P3] 早於存活之父起始之「子」為 PID 回收造成之假關係, 不算', function() {
        let table = [{ pid: 10, ppid: 1, startMs: t }, { pid: 11, ppid: 10, startMs: t - 3600000 }, { pid: 12, ppid: 10, startMs: t + 5 }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 10, startMs: t }]), [12, 10])
    })

    it('[S-P4] 環狀 ppid 不會無窮迴圈; 無根回空', function() {
        let table = [{ pid: 1, ppid: 2, startMs: t }, { pid: 2, ppid: 1, startMs: t }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 1, startMs: t }]).sort(), [1, 2])
        assert.strict.deepEqual(findProcessDescendants(table, []), [])
    })

    it('[S-P5] protect 內之 PID 不納入, 也不經其往下走', function() {
        let table = [{ pid: 1, ppid: 0, startMs: t }, { pid: 2, ppid: 1, startMs: t + 1 }, { pid: 3, ppid: 2, startMs: t + 2 }, { pid: 4, ppid: 1, startMs: t + 3 }]
        assert.strict.deepEqual(findProcessDescendants(table, [{ pid: 1, startMs: t }], { protect: [2] }).sort(), [1, 4])
    })

})


describe('sampleShardKnown', function() {

    //需求: 取樣不得把誤認寫入 known
    it('[S-V3] 事故之表: 已結束之 PID 不走其下, 下游全部不入 known; 已結束者之紀錄移除', function() {
        let r = sampleShardKnown([...SELF, ...VICTIMS], [{ pid: DEAD_P, startMs: T0 + 1000, image: 'node.exe' }])
        assert.strict.deepEqual(r, { known: [], added: 0, dropped: 1 })
    })

    it('[S-V3b] PID 被回收且起始時間差在 60 秒內: 不算同一行程, 其子不入 known', function() {
        for (let d of [1, 1000, 59000, -59000]) {
            let table = [{ pid: 8000, ppid: 1, startMs: T0 + d, image: 'other.exe' }, { pid: 8004, ppid: 8000, startMs: T0 + 60000, image: 'other2.exe' }]
            let r = sampleShardKnown(table, [{ pid: 8000, startMs: T0, image: 'node.exe' }])
            assert.strict.deepEqual(r.known, [], `差 ${d} 毫秒`)
        }
    })

    it('[S-V3c] 存活且身分相符: 沿存活父子鏈加入新子孫, 帶行程表之真實起始時間與映像名; 重複取樣不重複', function() {
        let table = [
            { pid: 8000, ppid: 1, startMs: T0, image: 'node.exe' },
            { pid: 8004, ppid: 8000, startMs: T0 + 10, image: 'cmd.exe' },
            { pid: 8008, ppid: 8004, startMs: T0 + 20, image: 'node.exe' },
            { pid: 8012, ppid: 8000, startMs: T0 - 10, image: 'old.exe' }, //起始早於存活之父: 假關係
        ]
        let r = sampleShardKnown(table, [{ pid: 8000, startMs: T0, image: 'node.exe' }])
        assert.strict.equal(r.added, 2)
        assert.strict.equal(r.dropped, 0)
        assert.strict.deepEqual(r.known.map((k) => [k.pid, k.startMs, k.image]).sort((a, b) => a[0] - b[0]), [[8000, T0, 'node.exe'], [8004, T0 + 10, 'cmd.exe'], [8008, T0 + 20, 'node.exe']])
        let r2 = sampleShardKnown(table, r.known)
        assert.strict.equal(r2.added, 0)
        assert.strict.equal(r2.known.length, 3)
    })

    it('[S-V3d] 曾被取樣之孤兒(父已結束而自身存活): 保留; 中間行程結束後才起之孫不入 known', function() {
        let known = [{ pid: 8000, startMs: T0, image: 'cmd.exe' }, { pid: 8004, startMs: T0 + 10, image: 'node.exe' }]
        let table = [{ pid: 8004, ppid: 8000, startMs: T0 + 10, image: 'node.exe' }, { pid: 8020, ppid: 8000, startMs: T0 + 5000, image: 'x.exe' }]
        let r = sampleShardKnown(table, known)
        assert.strict.deepEqual(r.known.map((k) => k.pid), [8004])
        assert.strict.equal(r.dropped, 1)
    })

})


describe('reapShardProcesses', function() {

    let reap = (exec, o) => {
        let logs = []
        let r = reapShardProcesses({ exec, since: T0, phase: 'teardown', log: (s) => logs.push(s), ...SELF_OPT, ...o })
        return { ...r, logs }
    }

    //需求: 本次事故之表, 結果全部不得下殺
    it('[S-V1] 事故之表: known 含已結束之 PID p, 現存 nohup(ppid=p, 起始較晚) → node → claude → bash → node, 全部不下殺', function() {
        let { exec, calls } = fakeExec({ table: [...SELF, ...VICTIMS] })
        let r = reap(exec, { known: [{ pid: DEAD_P, startMs: T0 + 1000 }] })
        assert.strict.deepEqual(killedPids(calls), [])
        assert.strict.deepEqual(r.kills, [])
        //nohup 為父已結束之候選, 無從辨識而只記錄; 其下有存活之父, 不是候選
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason]), [[52000, 'no-evidence']])
    })

    it('[S-V1b] 事故之表於鎖檔殘留清除(無 since 下限之情形亦同): 不下殺', function() {
        let { exec, calls } = fakeExec({ table: [...SELF, ...VICTIMS] })
        let r = reap(exec, { known: [{ pid: DEAD_P, startMs: T0 - 86400000 * 3 }], since: T0 - 86400000 * 3, phase: 'stale-lock' })
        assert.strict.deepEqual(killedPids(calls), [])
        assert.strict.deepEqual(r.kills, [])
        let { exec: e2, calls: c2 } = fakeExec({ table: [...SELF, ...VICTIMS] })
        let r2 = reap(e2, { known: [{ pid: DEAD_P, startMs: T0 }], since: undefined })
        assert.strict.deepEqual(killedPids(c2), [])
        assert.strict.deepEqual(r2.skipped, [], '沒有 since 不列孤兒')
    })

    //需求: 存活行程 PID 被回收且起始時間差在 60 秒內, 不得下殺
    it('[S-V2] PID 被回收且起始時間差在 60 秒內: 不下殺其與其子', function() {
        for (let d of [1, 1000, 30000, 59000, -59000]) {
            let table = [...SELF, { pid: 8000, ppid: 1, startMs: T0 + d, image: 'other.exe' }, { pid: 8004, ppid: 8000, startMs: T0 + 60000, image: 'other2.exe' }]
            let { exec, calls } = fakeExec({ table })
            let r = reap(exec, { known: [{ pid: 8000, startMs: T0 }] })
            assert.strict.deepEqual(killedPids(calls), [], `差 ${d} 毫秒`)
            assert.strict.deepEqual(r.kills, [], `差 ${d} 毫秒`)
        }
    })

    //需求: 曾被取樣之真孤兒(父已結束、PID 與起始時間精確相符)仍被下殺
    it('[S-V4] 曾被取樣之真孤兒: 依據 identity 下殺, 其存活之子沿鏈下殺', function() {
        let table = [...SELF, { pid: 9000, ppid: DEAD_P, startMs: T0 + 500, image: 'node.exe' }, { pid: 9004, ppid: 9000, startMs: T0 + 600, image: 'chrome.exe' }]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [{ pid: 9000, startMs: T0 + 500 }] })
        assert.strict.deepEqual(killedPids(calls), [9004, 9000])
        assert.strict.deepEqual(r.kills.map((v) => [v.pid, v.basis]), [[9004, 'chain:9000'], [9000, 'identity']])
    })

    //需求: 存活根之整棵樹仍被下殺
    it('[S-V5] 存活根之整棵樹: 全部下殺, 由深到淺; 假子行程(起始早於存活之父)不下殺', function() {
        let table = [
            ...SELF,
            { pid: 9000, ppid: 7000, startMs: T0, image: 'node.exe' },
            { pid: 9004, ppid: 9000, startMs: T0 + 1, image: 'cmd.exe' },
            { pid: 9008, ppid: 9004, startMs: T0 + 2, image: 'node.exe' },
            { pid: 9012, ppid: 9008, startMs: T0 + 3, image: 'chrome.exe' },
            { pid: 9016, ppid: 9000, startMs: T0 - 5000, image: 'innocent.exe' },
        ]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [{ pid: 9000, startMs: T0 }] })
        assert.strict.deepEqual(killedPids(calls), [9012, 9008, 9004, 9000])
        assert.strict.deepEqual(r.kills.map((v) => v.basis), ['chain:9008', 'chain:9004', 'chain:9000', 'identity'])
    })

    //需求: 本行程與祖先不下殺
    it('[S-V6] 本行程與祖先: 即使身分相符也不下殺, 不經其往下走, 留 protected 紀錄', function() {
        let table = [...SELF, { pid: 7004, ppid: 7000, startMs: T0, image: 'mine.exe' }]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: SELF.map((v) => ({ pid: v.pid, startMs: v.startMs })), since: undefined })
        assert.strict.deepEqual(killedPids(calls), [])
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason]).sort(), [[5000, 'protected'], [6000, 'protected'], [7000, 'protected']])
        assert.strict.ok(r.logs.some((l) => /PID 7000 .*不下殺/.test(l)), r.logs.join('\n'))
    })

    it('[S-V6b] 本行程占埠: 仍不下殺; 祖先鏈於假關係處停止(起始較晚之「父」不是祖先)', function() {
        let table = [...SELF, { pid: 9000, ppid: 7000, startMs: T0 + 1, image: 'child.exe' }]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [], extra: [{ pid: 7000, port: 19200 }, { pid: 6000, port: 19300 }] })
        assert.strict.deepEqual(killedPids(calls), [])
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason, v.port]), [[7000, 'protected', 19200], [6000, 'protected', 19300]])
        //7100 之「父」6100 起始較晚: 不是祖先, 故 6100 不受保護(身分相符時可下殺)
        let t2 = [{ pid: 7100, ppid: 6100, startMs: T0, image: 'self.exe' }, { pid: 6100, ppid: 1, startMs: T0 + 5000, image: 'other.exe' }]
        let { exec: e2, calls: c2 } = fakeExec({ table: t2 })
        reap(e2, { known: [{ pid: 6100, startMs: T0 + 5000 }], selfPid: 7100, parentPid: 999, since: undefined })
        assert.strict.deepEqual(killedPids(c2), [6100])
    })

    //需求: 取不到行程表時不下殺
    it('[S-V8] 取不到行程表: 不下殺, 記警告', function() {
        let { exec, calls } = fakeExec({ tableFail: true })
        let r = reap(exec, { known: [{ pid: 9000, startMs: T0 }], extra: [{ pid: 9000, port: 19200 }] })
        assert.strict.equal(r.tableOk, false)
        assert.strict.deepEqual(calls.kill, [])
        assert.strict.ok(r.logs.some((l) => /警告: 取行程表失敗.*不下殺/.test(l)), r.logs.join('\n'))
    })

    //孤兒之取捨: 未曾被取樣者無從辨識(不讀其他行程之環境區塊與工作目錄), 一律不殺
    it('[S-V9] 未曾被取樣之孤兒: 不下殺(其存活之子亦不下殺), 記入 skipped 與警告', function() {
        let table = [...SELF, { pid: 9100, ppid: DEAD_P, startMs: T0 + 5, image: 'node.exe' }, { pid: 9104, ppid: 9100, startMs: T0 + 6, image: 'chrome.exe' }]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [] })
        assert.strict.deepEqual(killedPids(calls), [])
        assert.strict.deepEqual(r.kills, [])
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason]), [[9100, 'no-evidence']])
        assert.strict.ok(r.logs.some((l) => /無身分證據、未下殺之行程 1 個.*未曾被取樣之孤兒無從辨識/.test(l)), r.logs.join('\n'))
    })

    it('[S-V9c] 孤兒之候選限制: 起始早於 since、父仍存活者不列; 父之 PID 被回收(父起始較晚)者仍是候選', function() {
        let table = [
            ...SELF,
            { pid: 9300, ppid: DEAD_P, startMs: T0 - 1, image: 'early.exe' },
            { pid: 9304, ppid: 5000, startMs: T0 + 5, image: 'liveParent.exe' },
            { pid: 9308, ppid: 9320, startMs: T0 + 5, image: 'recycledParent.exe' },
            { pid: 9320, ppid: 5000, startMs: T0 + 9, image: 'newOwner.exe' },
        ]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [] })
        assert.strict.deepEqual(r.skipped.map((v) => v.pid), [9308])
        assert.strict.deepEqual(killedPids(calls), [])
    })

    it('[S-V10] 身分未確認之孤兒與監聽者: 不下殺、記警告與 killSkipped', function() {
        let table = [...SELF, { pid: 9400, ppid: DEAD_P, startMs: T0 + 5, image: 'a.exe' }, { pid: 9404, ppid: 5000, startMs: T0 + 6, image: 'listener.exe' }, { pid: 9408, ppid: DEAD_P, startMs: T0 + 7, image: 'b.exe' }]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [], extra: [{ pid: 9404, port: 19200 }] })
        assert.strict.deepEqual(killedPids(calls), [])
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason]).sort(), [[9400, 'no-evidence'], [9404, 'no-evidence'], [9408, 'no-evidence']])
        assert.strict.equal(r.skipped.find((v) => v.pid === 9404).port, 19200)
        assert.strict.ok(r.logs.some((l) => /埠 19200 之監聽者 PID 9404 listener\.exe 無身分證據, 不下殺/.test(l)), r.logs.join('\n'))
        assert.strict.ok(r.logs.some((l) => /無身分證據、未下殺之行程 2 個/.test(l)), r.logs.join('\n'))
    })

    it('[S-V10c] 監聽者: 身分未確認者不論父是否存活皆不下殺; 已確認者只下殺一次、不重複列', function() {
        let table = [...SELF, { pid: 9604, ppid: 5000, startMs: T0 + 6, image: 'listener.exe' }, { pid: 9700, ppid: DEAD_P, startMs: T0 + 6, image: 'known.exe' }]
        let { exec, calls } = fakeExec({ table })
        let r = reap(exec, { known: [{ pid: 9700, startMs: T0 + 6 }], extra: [{ pid: 9604, port: 19200 }, { pid: 9700, port: 19300 }, { pid: 111111, port: 19400 }] })
        assert.strict.deepEqual(killedPids(calls), [9700])
        assert.strict.deepEqual(r.kills.map((v) => [v.pid, v.basis]), [[9700, 'identity']])
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason, v.port]), [[9604, 'no-evidence', 19200]])
    })

    //pe309: 只殺指定之監聽者(restart、殘留清除); 其餘身分已確認者不動
    it('[S-V19] only: 身分已確認者中只殺所列; 所列而身分未確認者不殺; 空陣列不殺任何行程', function() {
        let table = [...SELF, { pid: 9800, ppid: DEAD_P, startMs: T0 + 6, image: 'back.exe' }, { pid: 9804, ppid: 9800, startMs: T0 + 7, image: 'backChild.exe' }, { pid: 9808, ppid: DEAD_P, startMs: T0 + 8, image: 'front.exe' }, { pid: 9812, ppid: 5000, startMs: T0 + 9, image: 'other.exe' }]
        let known = [{ pid: 9800, startMs: T0 + 6 }, { pid: 9808, startMs: T0 + 8 }]
        let a = fakeExec({ table })
        let ra = reap(a.exec, { known, only: [9804, 9812], since: undefined })
        assert.strict.deepEqual(killedPids(a.calls), [9804], '沿鏈走到之 9804 可殺; 9812 身分未確認; 9800、9808 未列')
        assert.strict.deepEqual(ra.kills.map((v) => [v.pid, v.basis]), [[9804, 'chain:9800']])
        let b = fakeExec({ table })
        reap(b.exec, { known, only: [], since: undefined })
        assert.strict.deepEqual(killedPids(b.calls), [])
    })

    //需求: 每次下殺都留紀錄(PID、映像名、起始時間、判定依據)
    it('[S-V12] 每筆下殺留完整紀錄並印 [shard] 列', function() {
        let table = [...SELF, { pid: 9000, ppid: DEAD_P, startMs: T0 + 500, image: 'node.exe' }]
        let { exec } = fakeExec({ table })
        let r = reap(exec, { known: [{ pid: 9000, startMs: T0 + 500 }] })
        let start = new Date(T0 + 500).toISOString()
        assert.strict.deepEqual(r.kills, [{ pid: 9000, image: 'node.exe', startMs: T0 + 500, start, basis: 'identity', phase: 'teardown', result: 'killed' }])
        assert.strict.ok(r.logs.includes(`[shard] 下殺 PID 9000 node.exe 起始 ${start} 依據 identity 階段 teardown 結果 killed`), r.logs.join('\n'))
    })

    it('[S-V13] 下殺結果原樣記錄(mismatch 等); 執行失敗記 exec-failed, 不改用其他方式重殺', function() {
        let table = [...SELF, { pid: 9000, ppid: DEAD_P, startMs: T0 + 500, image: 'node.exe' }]
        let a = fakeExec({ table, killResult: 'mismatch' })
        assert.strict.deepEqual(reap(a.exec, { known: [{ pid: 9000, startMs: T0 + 500 }] }).kills.map((v) => v.result), ['mismatch'])
        let b = fakeExec({ table, killFail: true })
        assert.strict.deepEqual(reap(b.exec, { known: [{ pid: 9000, startMs: T0 + 500 }] }).kills.map((v) => v.result), ['exec-failed'])
        assert.strict.equal(b.calls.kill.length, 1)
    })

    it('[S-V14] Windows 下殺腳本: 不帶 /T、不用 taskkill, 每筆帶起始時間供同一 handle 比對', function() {
        let table = [...SELF, { pid: 9000, ppid: DEAD_P, startMs: T0 + 500, image: 'node.exe' }, { pid: 9004, ppid: 9000, startMs: T0 + 501, image: 'c.exe' }]
        let { exec, calls } = fakeExec({ table })
        reap(exec, { known: [{ pid: 9000, startMs: T0 + 500 }] })
        assert.strict.equal(calls.kill.length, 1)
        assert.strict.equal(calls.kill[0].prog, 'powershell')
        let script = decodePs(calls.kill[0].args)
        assert.strict.ok(!/taskkill|\/T\b|Stop-Process/.test(script), script)
        assert.strict.ok(script.includes(`'9004|${new Date(T0 + 501).toISOString()}'`), script)
        assert.strict.ok(script.includes(`'9000|${new Date(T0 + 500).toISOString()}'`), script)
        //釘住 handle 在前, 比對在後, 下殺最後
        let iHandle = script.indexOf('$p.Handle')
        let iCompare = script.indexOf('$s -ne $a[1]')
        let iKill = script.indexOf('$p.Kill()')
        assert.strict.ok(iHandle > 0 && iHandle < iCompare && iCompare < iKill, script)
    })

    it('[S-V14b] 非 Windows: 以 ps 取表、kill -9 逐筆下殺且身分判定相同', function() {
        let calls = []
        let exec = (prog, args, o) => {
            calls.push([prog, o.src, args])
            if (o.src === 'table') {
                return {
                    status: 0,
                    stdout: [
                        '  7000  6000 Wed Nov  4 22:00:00 2026 node',
                        '  9000     1 Wed Nov  4 22:00:10 2026 cmd',
                        '  9004  9000 Wed Nov  4 22:00:11 2026 node',
                        '  9100     1 Wed Nov  4 22:00:12 2026 other',
                    ].join('\n')
                }
            }
            return { status: 0, stdout: '' }
        }
        let known = [{ pid: 9000, startMs: Date.parse('Wed Nov  4 22:00:10 2026') }, { pid: 9100, startMs: Date.parse('Wed Nov  4 22:00:11 2026') }]
        let r = reapShardProcesses({ exec, known, platform: 'linux', selfPid: 7000, parentPid: 6000, phase: 'teardown' })
        assert.strict.deepEqual(r.kills.map((v) => [v.pid, v.image, v.result]), [[9004, 'node', 'killed'], [9000, 'cmd', 'killed']])
        let k = calls.filter((c) => c[1] === 'kill')
        assert.strict.deepEqual(k.map((c) => [c[0], c[2]]), [['sh', ['-c', 'kill -9 "$1"', 'sh', '9004']], ['sh', ['-c', 'kill -9 "$1"', 'sh', '9000']]])
    })

    it('[S-V14c] 非 Windows: 由 init 收養(ppid=1)者視為孤兒候選, 只記錄不下殺; 不讀 /proc', function() {
        let t = Date.parse('Wed Nov  4 22:00:10 2026')
        let calls = []
        let exec = (prog, args, o) => {
            calls.push([o.src, args])
            if (o.src === 'table') {
                return {
                    status: 0,
                    stdout: [
                        '  1     0 Wed Nov  4 21:00:00 2026 init',
                        '  7000  1 Wed Nov  4 21:30:00 2026 node',
                        '  9100  1 Wed Nov  4 22:00:10 2026 orphanA',
                        '  9104  1 Wed Nov  4 22:00:11 2026 orphanB',
                    ].join('\n'),
                }
            }
            return { status: 0, stdout: '' }
        }
        let r = reapShardProcesses({ exec, known: [], since: t, platform: 'linux', selfPid: 7000, parentPid: 1, phase: 'teardown' })
        assert.strict.deepEqual(r.kills, [])
        assert.strict.deepEqual(r.skipped.map((v) => [v.pid, v.reason]), [[9100, 'no-evidence'], [9104, 'no-evidence']])
        assert.strict.deepEqual(calls.map((c) => c[0]), ['table'])
    })

    it('[S-V15] 不呼叫任何注入以外之執行(注入即全部走注入, 不碰真實行程)', function() {
        let { exec, calls } = fakeExec({ table: [...SELF, ...VICTIMS] })
        reap(exec, { known: [{ pid: DEAD_P, startMs: T0 }] })
        assert.strict.equal(calls.table, 1)
    })

})


describe('listProcessTable', function() {

    let run = (r, platform = 'win32') => listProcessTable({ platform, exec: () => r })

    it('[S-V16] 解析: PID、父 PID、起始時間、映像名(含空白); 略過不合格列', function() {
        let iso = '2026-11-04T14:00:00.1234560Z'
        let rows = run({ status: 0, stdout: `\r\n10 1 ${iso} node.exe\r\n11 10 ${iso} Some App.exe\r\nbad line\r\n12 10 notadate x.exe\r\n13 10 ${iso}\r\n` })
        assert.strict.deepEqual(rows, [
            { pid: 10, ppid: 1, startMs: Date.parse('2026-11-04T14:00:00.123Z'), image: 'node.exe' },
            { pid: 11, ppid: 10, startMs: Date.parse('2026-11-04T14:00:00.123Z'), image: 'Some App.exe' },
            { pid: 13, ppid: 10, startMs: Date.parse('2026-11-04T14:00:00.123Z'), image: '' },
        ])
    })

    it('[S-V16b] 查詢失敗一律回 null: 離開碼非 0、error、拋錯、無回傳、查無任何行程', function() {
        assert.strict.equal(run({ status: 1, stdout: '1 0 2026-11-04T14:00:00.000Z x' }), null)
        assert.strict.equal(run({ status: null, stdout: '', error: new Error('x') }), null)
        assert.strict.equal(run(null), null)
        assert.strict.equal(run({ status: 0, stdout: '' }), null)
        assert.strict.equal(listProcessTable({
            platform: 'win32',
            exec: () => {
                throw new Error('x')
            }
        }), null)
    })

    it('[S-V16c] 非 Windows: 解析 ps 之 lstart 與 comm', function() {
        let rows = run({ status: 0, stdout: ' 321 1 Wed Nov  4 22:35:22 2026 node\n' }, 'linux')
        assert.strict.deepEqual(rows, [{ pid: 321, ppid: 1, startMs: Date.parse('Wed Nov  4 22:35:22 2026'), image: 'node' }])
    })

})


//pe309: 不讀其他行程之環境區塊與工作目錄(可能碰到金鑰, 又依賴未公開之 PEB 偏移)
describe('不讀其他行程之環境區塊', function() {

    it('[S-V17] src 與 tools 內沒有讀環境區塊、工作目錄之程式; 下殺依據只留 identity、chain、own-child-handle', function() {
        let fdPkg = fileURLToPath(new URL('..', import.meta.url))
        let files = [
            ...fs.readdirSync(path.join(fdPkg, 'src')).map((f) => path.join(fdPkg, 'src', f)),
            ...fs.readdirSync(path.join(fdPkg, 'tools')).map((f) => path.join(fdPkg, 'tools', f)),
        ].filter((f) => /\.(mjs|cjs)$/.test(f))
        for (let f of files) {
            let s = fs.readFileSync(f, 'utf8')
            for (let bad of ['ReadProcessMemory', 'NtQueryInformationProcess', 'Add-Type', '/environ', 'readProcessEvidence', 'env-marker', 'instance-cwd', 'E2E_SHARD_RUN']) {
                assert.strict.equal(s.includes(bad), false, `${f} 不得含 ${bad}`)
            }
        }
    })

    it('[S-V17b] 舊匯出已移除; 孤兒路徑之執行只有查表', function() {
        return import('../src/runShardedE2e.mjs').then((m) => {
            assert.strict.equal(m.readProcessEvidence, undefined)
            let { exec, calls } = fakeExec({ table: [...SELF, ...VICTIMS] })
            reapShardProcesses({ exec, since: T0, known: [], phase: 't', ...SELF_OPT })
            assert.strict.equal(calls.table, 1)
            assert.strict.deepEqual(calls.kill, [])
        })
    })

})
