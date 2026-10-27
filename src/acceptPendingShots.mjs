import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'
import reviewPendingShots from './reviewPendingShots.mjs'


/**
 * 採用比對失敗證據：把指定標籤之最新當次截圖(capture)複製為正式標準圖(收集模式之單趟執行後，審過差異才採用)
 *
 * 只處理labels明列之標籤(未給或空陣列即拋錯，不會改寫任何標準圖)；全部標籤先驗證、全部通過才開始複製：
 * ①證據目錄須有該標籤之證據(給since者只看其後)；②正式標準圖路徑取自收集模式之案例清單(baselinePath)；無清單者無法證實其案例結局，須明示legacy:true並以pathOf(label)給定，否則拒收；
 * 相對路徑以明給之root解析，未給root則以案例清單所記比對時之工作目錄(cwd)解析，皆無才用process.cwd()(自他目錄執行時不寫錯地方)；
 * ③案例清單之outcome為'failed'(案例另因語意斷言、比對錯誤等失敗)者、或證據被不同案例清單引用(conflict)者拒收(截圖可能是壞畫面；修好後重跑該案)；
 * ④證據過期即拒收：有baseline副本者正式標準圖須仍與副本逐位元相同(其後已被改寫即拒收)，缺標準圖之證據(MISSING)者正式標準圖須仍不存在；
 * ⑤capture須為可解碼之PNG；⑥多個標籤指向同一正式標準圖者拒收(後者會覆蓋前者；以檔案身分或真實路徑判定，junction、符號連結、硬連結、大小寫別名皆視為同一)。
 * dryRun為true時只驗證並回傳預定之複製清單，不寫檔
 *
 * @param {Object} opt 輸入設定物件
 * @param {Array} opt.labels 輸入要採用之標籤字串陣列(證據檔名之標籤，即比對時之label)
 * @param {String} [opt.pendingDir='./testPending'] 輸入證據目錄字串，預設'./testPending'
 * @param {String} [opt.root] 輸入解析相對標準圖路徑之根目錄字串，預設為案例清單所記比對時之工作目錄，再預設process.cwd()
 * @param {Function} [opt.pathOf=null] 輸入無案例清單時之標準圖路徑函數(label)=>路徑字串，預設null
 * @param {Boolean} [opt.legacy=false] 輸入是否允許採用無案例清單之證據(非收集模式之舊證據)布林值，須併給pathOf，預設false
 * @param {Boolean} [opt.dryRun=false] 輸入是否只驗證不寫檔布林值，預設false
 * @param {Date|Number|String} [opt.since=null] 輸入只採用此時刻(含)之後之證據(同reviewPendingShots；本趟開始時間，免採用前幾趟殘留之舊證據)，預設null代表全部
 * @param {Function} [opt.log=console.log] 輸入輸出函數，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳陣列，元素為{label,cls,from,to}
 * @example
 *
 * import acceptPendingShots from 'w-package-tools-e2e/src/acceptPendingShots.mjs'
 *
 * let done = await acceptPendingShots({ labels: ['sso-edit-eng-E2E-009-4-saved'] })
 * console.log(done) //[{ label, cls: 'CHANGED', from: './testPending/...__capture.png', to: 'C:/proj/test/pics/...png' }]
 *
 */
async function acceptPendingShots(opt = {}) {
    let { labels, pendingDir = './testPending', root = process.cwd(), pathOf = null, legacy = false, dryRun = false, since = null, log = console.log } = opt
    if (!Array.isArray(labels) || labels.length === 0 || labels.some((s) => typeof s !== 'string' || s === '')) {
        throw new Error('acceptPendingShots: labels 須為非空之標籤字串陣列(未指定不採用任何截圖)')
    }
    let rs = await reviewPendingShots({ pendingDir, labels, since })
    let byLabel = new Map(rs.map((r) => [r.label, r]))
    let plan = []
    let problems = []
    for (let label of labels) {
        let r = byLabel.get(label)
        if (!r) {
            problems.push(`${label}: ${pendingDir} 內無此標籤之證據${since ? '(since 之後)' : ''}`)
            continue
        }
        if (r.outcome === 'failed') {
            problems.push(`${label}: 所屬案例 ${r.caseKey} 另因錯誤失敗(語意斷言、比對錯誤等)，其截圖不得採用；修好後重跑該案`)
            continue
        }
        if (r.conflict) {
            problems.push(`${label}: 證據同時被不同案例或結局之案例清單引用(跨行程撞名等)，無法確認其結局；請重跑比對`)
            continue
        }
        //無案例清單者無法證實其案例結局(清單寫入失敗、遺失或非收集模式之證據): 須明示 legacy 才以 pathOf 採用
        if (!r.caseKey && !legacy) {
            problems.push(`${label}: 無案例清單(無法證實其案例結局)；確為非收集模式之證據者給 legacy:true 並以 pathOf 給路徑`)
            continue
        }
        //相對路徑之根: 明給 root 者以之, 否則以比對當時之工作目錄(案例清單之 cwd), 皆無則 process.cwd()
        let base = opt.root !== undefined ? root : (r.cwd || process.cwd())
        let raw = r.baselinePath || (typeof pathOf === 'function' ? pathOf(label) : null)
        if (!raw) {
            problems.push(`${label}: 無案例清單可取標準圖路徑(非收集模式之證據)，請給 pathOf`)
            continue
        }
        let to = path.resolve(base, raw)
        try {
            PNG.sync.read(fs.readFileSync(r.capturePath))
        }
        catch (err) {
            problems.push(`${label}: 證據之 capture 不是可解碼之 PNG(${err.message})`)
            continue
        }
        if (r.baselineCopyPath) {
            if (!fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(r.baselineCopyPath))) {
                problems.push(`${label}: 正式標準圖 ${to} 已與證據中之標準圖副本不同(證據過期)，請重跑比對`)
                continue
            }
        }
        else if (fs.existsSync(to)) {
            problems.push(`${label}: 證據為缺標準圖，但 ${to} 現已存在(證據過期)，請重跑比對`)
            continue
        }
        plan.push({ label, cls: r.cls, from: r.capturePath, to })
    }
    //多個標籤指向同一標準圖: 後者會覆蓋前者, 拒收; 以檔案身分(已存在者之 dev:ino, 含硬連結)或最近既有祖先之真實路徑(解開 junction／符號連結)判定, Windows 不分大小寫
    let targetId = (p) => {
        let abs = path.resolve(p)
        if (fs.existsSync(abs)) {
            let st = fs.statSync(abs, { bigint: true })
            return `ino:${st.dev}:${st.ino}`
        }
        let rest = []
        let cur = abs
        while (!fs.existsSync(cur)) {
            let up = path.dirname(cur)
            if (up === cur) {
                break
            }
            rest.unshift(path.basename(cur))
            cur = up
        }
        let id = path.join(fs.existsSync(cur) ? fs.realpathSync.native(cur) : cur, ...rest)
        return process.platform === 'win32' ? id.toLowerCase() : id
    }
    let seen = new Map()
    for (let p of plan) {
        let k = targetId(p.to)
        if (seen.has(k)) {
            problems.push(`${p.label}: 與 ${seen.get(k)} 指向同一標準圖 ${p.to}，請只採用其一`)
            continue
        }
        seen.set(k, p.label)
    }
    if (problems.length > 0) {
        throw new Error(`acceptPendingShots: 未採用任何截圖:\n${problems.map((s) => `  - ${s}`).join('\n')}`)
    }
    if (dryRun) {
        return plan
    }
    for (let p of plan) {
        fs.mkdirSync(path.dirname(p.to), { recursive: true })
        fs.copyFileSync(p.from, p.to)
        if (typeof log === 'function') {
            log(`[accept] ${p.label} (${p.cls}) → ${p.to}`)
        }
    }
    return plan
}


export default acceptPendingShots
