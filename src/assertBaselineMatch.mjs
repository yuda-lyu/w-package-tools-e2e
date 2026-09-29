import fs from 'fs'
import path from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'


/**
 * 截圖與標準圖比對(反鋸齒感知之像素比對加容差)，不一致時保留三聯組證據後拋錯
 *
 * 比對：pixelmatch之includeAA:false自動忽略反鋸齒邊緣像素，threshold預設0.1，真不同像素數超過maxDiffPixels(預設100)即失敗；
 * 尺寸不同必為真差異，直接失敗；標準圖不存在直接拋錯。像素層為補強，呼叫前每案仍須先有語意斷言。
 * 證據：失敗時把當次截圖、標準圖與差異圖存到pendingDir(預設'./testPending')，檔名為`<label>__<毫秒時間戳>__{capture,baseline,diff}.png`，撞名加-N，永不覆蓋、不自動刪除。
 * 餘裕告警：通過但真不同像素數超過maxDiffPixels之headroomRatio(預設0.5)時印告警——計數貼近上限之標準圖為零餘裕之flake源(2026-09-28 實測兩張恰為100)，應重產或查因。
 * 本函數只比對不寫檔：標準圖之寫檔一律經runBaselineCase(全部斷言通過後才寫)；原opt.regen寫檔旁路(第二條寫檔路徑、先寫圖後斷言)已於2026-09-28移除。
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
 * @returns {undefined} 通過時無回傳，不一致時拋出錯誤
 * @example
 *
 * import assertBaselineMatch from 'w-package-tools-e2e/src/assertBaselineMatch.mjs'
 *
 * assertBaselineMatch(buf, './test/pics/tokens/tokens-eng-E2E-001-list-loaded.png', 'tokens-eng-E2E-001-list-loaded')
 *
 */
function assertBaselineMatch(buf, baselinePath, label = '', opt = {}) {
    let { maxDiffPixels = 100, threshold = 0.1, pendingDir = './testPending', headroomRatio = 0.5, warn = console.warn } = opt
    if (opt.regen !== undefined) {
        throw new Error('assertBaselineMatch: opt.regen 已移除(2026-09-28), 標準圖寫檔請經 runBaselineCase')
    }

    if (!fs.existsSync(baselinePath)) {
        throw new Error(`標準圖不存在: ${baselinePath} (請先執行對應 e2e --baseline 產製)`)
    }
    let baselineBuf = fs.readFileSync(baselinePath)

    //解碼PNG為RGBA(pngjs同步, 保持本函數同步)
    let capPng = PNG.sync.read(buf)
    let basePng = PNG.sync.read(baselineBuf)

    //失敗: 保留capture/baseline(/diff)至pendingDir(不覆蓋, 帶毫秒時間戳)後拋錯
    let dump = (reason, diffPng) => {
        if (!fs.existsSync(pendingDir)) {
            fs.mkdirSync(pendingDir, { recursive: true })
        }
        let safe = (label || path.basename(baselinePath, '.png')).replace(/[^\w.-]/g, '_')
        let ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
        let stem = `${pendingDir}/${safe}__${ts}`
        let n = 0
        while (fs.existsSync(`${stem}__capture.png`) || fs.existsSync(`${stem}__baseline.png`)) {
            n += 1
            stem = `${pendingDir}/${safe}__${ts}-${n}`
        }
        fs.writeFileSync(`${stem}__capture.png`, buf)
        fs.writeFileSync(`${stem}__baseline.png`, baselineBuf)
        if (diffPng) {
            fs.writeFileSync(`${stem}__diff.png`, PNG.sync.write(diffPng))
        }
        throw new Error(`截圖與標準圖不一致 (${reason}): ${safe} — capture/baseline${diffPng ? '/diff' : ''} 已存 ${stem}__*.png 供 diff`)
    }

    //尺寸不同必為真差異(版面/裁切變)
    if (capPng.width !== basePng.width || capPng.height !== basePng.height) {
        dump(`尺寸不同 cap=${capPng.width}x${capPng.height} base=${basePng.width}x${basePng.height}`)
    }

    //pixelmatch: 反鋸齒感知比對, 回傳真不同像素數
    let { width, height } = basePng
    let diffPng = new PNG({ width, height })
    let numDiff = pixelmatch(capPng.data, basePng.data, diffPng.data, width, height, { threshold, includeAA: false })
    if (numDiff <= maxDiffPixels) {
        if (numDiff > maxDiffPixels * headroomRatio) {
            warn(`[baseline-headroom] ${label || path.basename(baselinePath, '.png')}: 通過但 diff=${numDiff}px 已超過 maxDiffPixels=${maxDiffPixels} 之 ${Math.round(headroomRatio * 100)}%，餘裕不足(再多 ${maxDiffPixels - numDiff + 1}px 即失敗)，應查因或重產`)
        }
        return
    }
    dump(`diff=${numDiff}px > maxDiffPixels=${maxDiffPixels}`, diffPng)
}


export default assertBaselineMatch
