//e2e 分組多開: 把專案之 e2e 檔分組, 各組放進以埠位移之臨時實例同時跑, 彙整結果後移除實例(只跑比對, 不寫標準圖)。於專案根執行:
//  node node_modules/w-package-tools-e2e/tools/shardE2e.mjs [選項]
//設定讀 test/tools/e2eShard.json(可不存在), 下列參數覆寫同名欄位; 規格見 README §2.11。
//--plan 只印分組與預估, 不取鎖、不建立任何東西、不執行。--update-durations 才把實測耗時寫回設定檔, 預設只印不改檔。
//離開碼: 0 全部通過; 1 有失敗、未跑完、某組無統計、收尾失敗或開跑前之問題(預檢、鎖、設定); 2 參數錯誤; 128＋訊號值 收到終止訊號。
//路徑：使用端為 node_modules/w-package-tools-e2e/tools/，套件內為 tools/；用法訊息印實際執行路徑，不綁目錄。
import path from 'path'
import { fileURLToPath } from 'url'
import runShardedE2e from '../src/runShardedE2e.mjs'

//本檔相對 cwd 之路徑(用法訊息用; 模組自身位置, 全域 §7.1 場景 B)
let self = path.relative(process.cwd(), fileURLToPath(import.meta.url)).replace(/\\/g, '/')
let usage = `usage: node ${self} [--root <dir>] [--config <path>] [--plan] [--ports <埠,...>] [--instances <N>] [--official-only <檔,...>] [--together <檔,檔;檔,檔>] [--durations <JSON>] [--exclude <路徑,...>] [--port-step <N>] [--port-tries <N>] [--port-wait-min <分>] [--mem-per-instance <GB>] [--work-dir <dir>] [--out-dir <dir>] [--mocha-args "<以空白分隔之參數>"] [--group-timeout-min <分>] [--progress-min <分>] [--tree-sample-ms <毫秒>] [--update-durations] [--debug]`

let fail = (msg) => {
    console.error(`${msg}\n${usage}`)
    process.exit(2)
}
let argv = process.argv.slice(2)
let need = (i) => {
    let v = argv[i]
    if (v === undefined || (String(v).startsWith('--') && argv[i - 1] !== '--mocha-args')) {
        fail(`${argv[i - 1]} 缺少值`)
    }
    return v
}
let list = (s) => s.split(',').map((v) => v.trim()).filter(Boolean)
let num = (name, s, re) => {
    if (!re.test(s)) {
        fail(`${name} 數值不合法，實得「${s}」`)
    }
    return Number(s)
}
let reInt = /^[1-9]\d*$/
let rePos = /^(\d+(\.\d+)?|\.\d+)$/

let o = { root: process.cwd() }
for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a === '--root') {
        o.root = need(++i)
    }
    else if (a === '--config') {
        o.configPath = need(++i)
    }
    else if (a === '--plan') {
        o.plan = true
    }
    else if (a === '--update-durations') {
        o.updateDurations = true
    }
    else if (a === '--debug') {
        o.debug = true
    }
    else if (a === '--ports') {
        o.ports = list(need(++i)).map((v) => num(a, v, reInt))
    }
    else if (a === '--instances') {
        o.instances = num(a, need(++i), reInt)
    }
    else if (a === '--official-only') {
        o.officialOnly = list(need(++i))
    }
    else if (a === '--together') {
        o.together = need(++i).split(';').map(list).filter((v) => v.length > 0)
    }
    else if (a === '--durations') {
        try {
            o.durations = JSON.parse(need(++i))
        }
        catch (err) {
            fail(`--durations 須為 JSON 物件(${err.message})`)
        }
    }
    else if (a === '--exclude') {
        o.exclude = list(need(++i))
    }
    else if (a === '--port-step') {
        o.portStep = num(a, need(++i), reInt)
    }
    else if (a === '--port-tries') {
        o.portTries = num(a, need(++i), reInt)
    }
    else if (a === '--port-wait-min') {
        o.portWaitMs = Math.round(num(a, need(++i), rePos) * 60000)
    }
    else if (a === '--mem-per-instance') {
        o.memPerInstanceGb = num(a, need(++i), rePos)
    }
    else if (a === '--work-dir') {
        o.workDir = need(++i)
    }
    else if (a === '--out-dir') {
        o.outDir = need(++i)
    }
    else if (a === '--mocha-args') {
        o.mochaArgs = need(++i).trim().split(/\s+/).filter(Boolean)
    }
    else if (a === '--group-timeout-min') {
        o.groupTimeoutMs = Math.round(num(a, need(++i), rePos) * 60000)
    }
    else if (a === '--progress-min') {
        o.progressMs = Math.round(num(a, need(++i), rePos) * 60000)
    }
    else if (a === '--tree-sample-ms') {
        o.treeSampleMs = num(a, need(++i), reInt)
    }
    else {
        fail(`不明參數「${a}」`)
    }
}

try {
    let r = await runShardedE2e(o)
    process.exit(r.exitCode)
}
catch (err) {
    console.error(`[shard] ✘ ${err.message}`)
    process.exit(1)
}
