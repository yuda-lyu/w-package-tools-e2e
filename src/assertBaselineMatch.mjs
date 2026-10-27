import fs from 'fs'
import path from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { activeBaselineCollector } from './createBaselineCollector.mjs'


/**
 * 截圖與標準圖比對(反鋸齒感知之像素比對加容差)，不一致時保留三聯組證據後拋錯
 *
 * 比對：pixelmatch之includeAA:false自動忽略反鋸齒邊緣像素，threshold預設0.1，真不同像素數超過maxDiffPixels(預設100)即失敗；
 * 尺寸不同必為真差異，直接失敗；標準圖不存在直接拋錯。像素層為補強，呼叫前每案仍須先有語意斷言。
 * 證據：失敗時把當次截圖、標準圖與差異圖存到pendingDir(預設'./testPending')，檔名為`<label>__<毫秒時間戳>__{capture,baseline,diff}.png`，撞名加-N(capture以排他建立保留，跨行程同毫秒亦不共用)，永不覆蓋、不自動刪除。
 * 餘裕告警：通過但真不同像素數超過maxDiffPixels之headroomRatio(預設0.5)時印告警——計數貼近上限之標準圖為零餘裕之flake源(2026-09-28 實測兩張恰為100)，應重產或查因。
 * 本函數只比對不寫檔：標準圖之寫檔一律經runBaselineCase(全部斷言通過後才寫)；原opt.regen寫檔旁路(第二條寫檔路徑、先寫圖後斷言)已於2026-09-28移除。
 * 收集模式(預設關閉)：使用之收集器啟用時(見createBaselineCollector；E2E_COLLECT=1或runBaselineCase之collect)，不一致照常存證據但不拋錯，改記一筆紀錄並回傳之；
 * 標準圖不存在亦記為'missing'並把當次截圖存為`<label>__<時間戳>__capture.png`(候選標準圖；截圖須可解碼，否則照常拋出解碼錯誤)；通過亦記一筆'pass'。
 * 使用之收集器：opt.collect為收集器物件者用之(須已啟用且即目前非同步脈絡之作用中收集器)；未給時用目前作用中之收集器(collector.run或runBaselineCase收集模式之範圍內)且須已啟用；
 * opt.collect為true時用作用中之收集器(不論enabled)；opt.collect為false、或範圍外無收集器時一律不收集(照常拋錯，防無人彙整之假綠)。
 *
 * 本函數為同步函數
 *
 * @param {Buffer} buf 輸入當次截圖PNG之Buffer
 * @param {String} baselinePath 輸入標準圖路徑字串
 * @param {String} [label=''] 輸入證據檔名用之可讀標籤字串，預設''代表使用標準圖檔名
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.maxDiffPixels=100] 輸入容許之真不同像素數，預設100
 * @param {Number} [opt.threshold=0.1] 輸入pixelmatch之色差門檻，預設0.1
 * @param {String} [opt.pendingDir='./testPending'] 輸入失敗證據目錄字串，預設'./testPending'
 * @param {Number} [opt.headroomRatio=0.5] 輸入餘裕告警比例，通過但真不同像素數大於maxDiffPixels乘此比例時告警，預設0.5；設為1以上即不告警
 * @param {Function} [opt.warn=console.warn] 輸入告警輸出函數，預設console.warn
 * @param {Boolean|Object} [opt.collect] 輸入收集模式設定，未給代表依作用中收集器是否啟用、true代表用作用中收集器、false代表不收集、收集器物件代表用之，預設未給
 * @returns {undefined|Object} 非收集時：通過無回傳、不一致拋出錯誤；收集時回傳該次紀錄物件{label,status,numDiff,...}(status為'pass'、'diff'、'size'或'missing')
 * @example
 *
 * import assertBaselineMatch from 'w-package-tools-e2e/src/assertBaselineMatch.mjs'
 *
 * assertBaselineMatch(buf, './test/pics/tokens/tokens-eng-E2E-001-list-loaded.png', 'tokens-eng-E2E-001-list-loaded')
 *
 */
function assertBaselineMatch(buf, baselinePath, label = '', opt = {}) {
    let { maxDiffPixels = 100, threshold = 0.1, pendingDir = './testPending', headroomRatio = 0.5, warn = console.warn, collect } = opt
    if (opt.regen !== undefined) {
        throw new Error('assertBaselineMatch: opt.regen 已移除(2026-09-28), 標準圖寫檔請經 runBaselineCase')
    }

    //收集模式: 決定使用之收集器(null 代表照常拋錯); 明示之收集器須即目前脈絡之作用中收集器(其這一次 run 內), 免無人彙整或歸錯案例
    let col = null
    if (collect && typeof collect === 'object') {
        col = collect.enabled && activeBaselineCollector() === collect ? collect : null
    }
    else if (collect !== false) {
        let act = activeBaselineCollector()
        if (act && (act.enabled || collect === true)) {
            col = act
        }
    }
    let safe = (label || path.basename(baselinePath, '.png')).replace(/[^\w.-]/g, '_')

    //證據存至pendingDir(不覆蓋, 帶毫秒時間戳), 回傳檔名主幹; capture 以排他建立保留檔名主幹(跨行程同毫秒同標籤時不共用同一組)
    let save = (files) => {
        if (!fs.existsSync(pendingDir)) {
            fs.mkdirSync(pendingDir, { recursive: true })
        }
        let ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
        let n = 0
        let stemOf = () => (n === 0 ? `${pendingDir}/${safe}__${ts}` : `${pendingDir}/${safe}__${ts}-${n}`)
        for (;;) {
            let stem = stemOf()
            if (fs.existsSync(`${stem}__capture.png`) || fs.existsSync(`${stem}__baseline.png`)) {
                n += 1
                continue
            }
            let [[suffix0, getBuf0], ...rest] = files
            try {
                fs.writeFileSync(`${stem}__${suffix0}.png`, getBuf0(), { flag: 'wx' })
            }
            catch (err) {
                if (err.code === 'EEXIST') {
                    n += 1
                    continue
                }
                throw err
            }
            for (let [suffix, getBuf] of rest) {
                fs.writeFileSync(`${stem}__${suffix}.png`, getBuf())
            }
            return stem
        }
    }

    if (!fs.existsSync(baselinePath)) {
        if (!col) {
            throw new Error(`標準圖不存在: ${baselinePath} (請先執行對應 e2e --baseline 產製)`)
        }
        //收集: 當次截圖即候選標準圖(須可解碼, 否則照常拋出解碼錯誤, 不存成候選)
        PNG.sync.read(buf)
        let stem = save([['capture', () => buf]])
        return col.add({ label: safe, status: 'missing', numDiff: null, maxDiffPixels, baselinePath, cwd: process.cwd(), stem })
    }
    let baselineBuf = fs.readFileSync(baselinePath)

    //解碼PNG為RGBA(pngjs同步, 保持本函數同步)
    let capPng = PNG.sync.read(buf)
    let basePng = PNG.sync.read(baselineBuf)
    let capSize = `${capPng.width}x${capPng.height}`
    let baseSize = `${basePng.width}x${basePng.height}`

    //失敗: 保留capture/baseline(/diff)至pendingDir; 收集時記錄並回傳該筆紀錄, 否則拋錯
    let dump = (reason, diffPng, rec) => {
        let files = [['capture', () => buf], ['baseline', () => baselineBuf]]
        if (diffPng) {
            files.push(['diff', () => PNG.sync.write(diffPng)])
        }
        let stem = save(files)
        if (col) {
            return col.add({ label: safe, maxDiffPixels, capSize, baseSize, baselinePath, cwd: process.cwd(), stem, ...rec })
        }
        throw new Error(`截圖與標準圖不一致 (${reason}): ${safe} — capture/baseline${diffPng ? '/diff' : ''} 已存 ${stem}__*.png 供 diff`)
    }

    //尺寸不同必為真差異(版面/裁切變)
    if (capPng.width !== basePng.width || capPng.height !== basePng.height) {
        return dump(`尺寸不同 cap=${capSize} base=${baseSize}`, null, { status: 'size', numDiff: null })
    }

    //pixelmatch: 反鋸齒感知比對, 回傳真不同像素數
    let { width, height } = basePng
    let diffPng = new PNG({ width, height })
    let numDiff = pixelmatch(capPng.data, basePng.data, diffPng.data, width, height, { threshold, includeAA: false })
    if (numDiff <= maxDiffPixels) {
        if (numDiff > maxDiffPixels * headroomRatio) {
            warn(`[baseline-headroom] ${label || path.basename(baselinePath, '.png')}: 通過但 diff=${numDiff}px 已超過 maxDiffPixels=${maxDiffPixels} 之 ${Math.round(headroomRatio * 100)}%，餘裕不足(再多 ${maxDiffPixels - numDiff + 1}px 即失敗)，應查因或重產`)
        }
        if (col) {
            return col.add({ label: safe, status: 'pass', numDiff, maxDiffPixels, capSize, baseSize, baselinePath, cwd: process.cwd(), stem: null })
        }
        return
    }
    return dump(`diff=${numDiff}px > maxDiffPixels=${maxDiffPixels}`, diffPng, { status: 'diff', numDiff })
}


export default assertBaselineMatch
