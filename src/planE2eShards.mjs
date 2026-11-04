//取兩位小數
function round2(v) {
    return Math.round(v * 100) / 100
}


//正數(含數字字串)取值, 其餘回 null
function toPos(v) {
    if (typeof v !== 'number' && typeof v !== 'string') {
        return null
    }
    if (typeof v === 'string' && v.trim() === '') {
        return null
    }
    let n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
}


//檢查檔名清單: 須為字串陣列且每項皆存在於 files(收嚴: 改名後未同步會使限制靜默失效)
function checkNames(names, set, key) {
    if (!Array.isArray(names)) {
        throw new Error(`planE2eShards: ${key} 須為檔名陣列`)
    }
    let lack = names.filter((f) => typeof f !== 'string' || !set.has(f))
    if (lack.length > 0) {
        throw new Error(`planE2eShards: ${key} 含不存在之檔名: ${lack.map(String).join(', ')}`)
    }
}


/**
 * 依耗時把e2e檔分組(純函數，不碰檔案與行程)：記憶體守門決定實例數後，由大到小放入目前最輕之組
 *
 * 分組單位為「不可拆之集合」：together有交集者合併；含officialOnly之檔者固定在第0組；各集合依估計耗時由大到小(同值依檔名)放入目前最輕之組(同輕取編號小者)，結果與輸入順序無關。
 * 實例數＝min(instances, 記憶體可容納數, 不可拆之集合數)；記憶體連1個都不夠時仍回1個並於warnings警告。缺durations之檔以已知檔之平均值估算，全無已知值時每檔以1分計。
 * officialOnly、together為安全限制，型別錯誤或含不存在之檔名一律拋錯(靜默略過即可能跑到錯誤之埠)；其餘選項之非預期值改用預設。
 *
 * @param {Object} opt 輸入設定物件
 * @param {Array} opt.files 輸入e2e檔名字串陣列，須非空
 * @param {Number} [opt.instances=5] 輸入要求之實例數，正整數，預設5
 * @param {Array} [opt.officialOnly=[]] 輸入只能跑在位移0(第0組)之檔名陣列，預設[]
 * @param {Array} [opt.together=[]] 輸入必須同組之檔名陣列之陣列，預設[]
 * @param {Object} [opt.durations={}] 輸入各檔耗時(分)物件，只用於分組，預設{}
 * @param {Number} [opt.availMemGb=null] 輸入可用記憶體(GB)，null為不做記憶體守門，預設null
 * @param {Number} [opt.memPerInstanceGb=1.5] 輸入每實例需要之記憶體(GB)，預設1.5
 * @returns {Object} 回傳物件{instancesRequested,instancesUsed,reasons,warnings,groups,estimated,unknownFiles,serialMin,wallMin}，groups元素為{index,files,estMin,officialOnly}，reasons為調降實例數之原因字串陣列，estimated為各檔採用之估計值，unknownFiles為以平均值估算之檔
 * @example
 *
 * import planE2eShards from 'w-package-tools-e2e/src/planE2eShards.mjs'
 *
 * let p = planE2eShards({
 *     files: ['e2e-a.test.mjs', 'e2e-b.test.mjs', 'e2e-c.test.mjs'],
 *     instances: 2,
 *     officialOnly: ['e2e-c.test.mjs'],
 *     durations: { 'e2e-a.test.mjs': 5, 'e2e-b.test.mjs': 3, 'e2e-c.test.mjs': 1 },
 * })
 * console.log(p.groups.map((g) => g.files))
 * // => [['e2e-b.test.mjs', 'e2e-c.test.mjs'], ['e2e-a.test.mjs']]
 *
 */
function planE2eShards(opt = {}) {
    let { files, officialOnly, together, durations, instances, availMemGb, memPerInstanceGb } = opt
    if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f !== 'string' || f === '')) {
        throw new Error('planE2eShards: files 須為非空之檔名字串陣列')
    }
    let list = [...new Set(files)].sort()
    let set = new Set(list)
    officialOnly = officialOnly === undefined || officialOnly === null ? [] : officialOnly
    together = together === undefined || together === null ? [] : together
    checkNames(officialOnly, set, 'officialOnly')
    if (!Array.isArray(together)) {
        throw new Error('planE2eShards: together 須為檔名陣列之陣列')
    }
    together.forEach((t) => checkNames(t, set, 'together'))

    //非預期值改用預設(K3)
    let reqRaw = toPos(instances)
    let requested = reqRaw !== null && Number.isInteger(reqRaw) ? reqRaw : 5
    let memPer = toPos(memPerInstanceGb) || 1.5
    let durs = durations && typeof durations === 'object' && !Array.isArray(durations) ? durations : {}

    //估計耗時: 缺者以已知檔之平均值, 全無已知值時每檔 1 分
    let known = list.map((f) => toPos(durs[f])).filter((v) => v !== null)
    let avg = known.length > 0 ? known.reduce((p, v) => p + v, 0) / known.length : 1
    let estimated = {}
    let unknownFiles = []
    for (let f of list) {
        let v = toPos(durs[f])
        if (v === null) {
            unknownFiles.push(f)
        }
        estimated[f] = v === null ? round2(avg) : v
    }

    //不可拆之集合: together 有交集者合併
    let parent = new Map(list.map((f) => [f, f]))
    let find = (f) => {
        while (parent.get(f) !== f) {
            f = parent.get(f)
        }
        return f
    }
    for (let t of together) {
        for (let i = 1; i < t.length; i++) {
            let a = find(t[0])
            let b = find(t[i])
            if (a !== b) {
                parent.set(a < b ? b : a, a < b ? a : b)
            }
        }
    }
    let atomMap = new Map()
    for (let f of list) {
        let r = find(f)
        if (!atomMap.has(r)) {
            atomMap.set(r, [])
        }
        atomMap.get(r).push(f)
    }
    let officialSet = new Set(officialOnly)
    let atoms = [...atomMap.values()].map((fs) => ({
        files: fs,
        est: fs.reduce((p, f) => p + estimated[f], 0),
        pinned: fs.some((f) => officialSet.has(f)),
    }))
    let pinned = atoms.filter((a) => a.pinned)
    let free = atoms.filter((a) => !a.pinned)
        .sort((a, b) => (b.est - a.est) || (a.files[0] < b.files[0] ? -1 : 1))

    //實例數: 記憶體守門 → 不可拆之集合數
    let reasons = []
    let warnings = []
    let used = requested
    let avail = typeof availMemGb === 'number' && Number.isFinite(availMemGb) ? availMemGb : null
    if (avail !== null) {
        let maxByMem = Math.floor(avail / memPer)
        if (maxByMem < 1) {
            warnings.push(`可用記憶體 ${round2(avail)} GB 不足 1 個實例(每實例 ${memPer} GB), 仍跑 1 個, 開頁逾時風險高`)
            if (used > 1) {
                reasons.push(`可用記憶體 ${round2(avail)} GB ÷ 每實例 ${memPer} GB 不足 1 個, 實例數 ${used} → 1`)
            }
            used = 1
        }
        else if (maxByMem < used) {
            reasons.push(`可用記憶體 ${round2(avail)} GB ÷ 每實例 ${memPer} GB = ${maxByMem} 個, 實例數 ${used} → ${maxByMem}`)
            used = maxByMem
        }
    }
    let maxByAtoms = free.length + (pinned.length > 0 ? 1 : 0)
    if (maxByAtoms < used) {
        reasons.push(`可分開之單元只有 ${maxByAtoms} 個(檔案 ${list.length}), 實例數 ${used} → ${maxByAtoms}`)
        used = maxByAtoms
    }

    //分組: officialOnly 所屬集合固定第 0 組, 其餘由大到小放入最輕之組
    let groups = Array.from({ length: used }, (_, index) => ({ index, files: [], est: 0 }))
    for (let a of pinned) {
        groups[0].files.push(...a.files)
        groups[0].est += a.est
    }
    for (let a of free) {
        let g = groups.reduce((p, c) => (c.est < p.est ? c : p), groups[0])
        g.files.push(...a.files)
        g.est += a.est
    }
    let out = groups.map((g) => ({
        index: g.index,
        files: g.files.slice().sort(),
        estMin: round2(g.est),
        officialOnly: g.files.filter((f) => officialSet.has(f)).sort(),
    }))
    return {
        instancesRequested: requested,
        instancesUsed: used,
        reasons,
        warnings,
        groups: out,
        estimated,
        unknownFiles,
        serialMin: round2(groups.reduce((p, g) => p + g.est, 0)),
        wallMin: round2(Math.max(...groups.map((g) => g.est))),
    }
}


export default planE2eShards
