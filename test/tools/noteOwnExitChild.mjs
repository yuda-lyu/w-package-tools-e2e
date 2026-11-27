//noteOwn 之背景取樣與計時器不阻擋行程結束(api-reserveE2ePorts [RA12]、[RA13] 之子行程)
//  node test/tools/noteOwnExitChild.mjs <登錄目錄> <retry|hang|real>
//不等待 noteOwn 之 Promise: 行程之其餘工作結束後須自行結束(離開碼 0)。
//  retry: 取樣失敗, 重試間隔長達 1 小時(重試計時器待命)
//  hang : 取行程表之查詢永不回調, 逾時上限長達 1 小時(逾時計時器待命)
//  real : 不注入 tableAsync(預設實作: 真實起行程表查詢指令), 逾時上限長達 1 小時(預設實作之逾時計時器與查詢行程待命);
//         另印出仍保持事件迴圈之資源種類(process.getActiveResourcesInfo), 供父行程斷言不含計時器與子行程
//若計時器或背景查詢保持事件迴圈, 本行程會留著至逾時, 由父行程判為失敗
import reserveE2ePorts from '../../src/reserveE2ePorts.mjs'


let regDir = process.argv[2]
let mode = process.argv[3]
let opt = {
    regDir,
    env: {},
    log: () => {},
    probe: (ports) => ports.map((port) => ({ port, free: true, host: '', code: '' })),
    noteTries: 3,
    noteRetryMs: 3600000,
    noteTimeoutMs: 3600000,
}
if (mode === 'hang') {
    opt.tableAsync = () => {}
}
else if (mode === 'retry') {
    opt.tableAsync = (cb) => cb(null)
}
let h = reserveE2ePorts([19582], opt)
h.noteOwn({ pid: process.pid, exitCode: null, signalCode: null })
console.log('noted-called')
console.log(`active-resources ${JSON.stringify(process.getActiveResourcesInfo())}`)
