import assert from 'assert'
import sharp from 'sharp'
import composeBox from '../src/composeBox.mjs'
import maskRegions from '../src/maskRegions.mjs'
import overlayRegions from '../src/overlayRegions.mjs'
import overlayImageAt from '../src/overlayImageAt.mjs'
import cropRegion from '../src/cropRegion.mjs'
import inkRect, { INK_PAD } from '../src/inkRect.mjs'


//影像運算之單元測試: 與四專案現行實作之「行為等價」(輸出逐位元相同)
//legacy*為各專案抽提前之實作逐字凍結(僅改為區域函數), 作為對照; 抽提版以預設值或選項重現之, 使各專案採用時不必重產標準圖


//—— 凍結之對照實作 ——

//w-web-sso test/tools/e2e-setup.mjs:484-498 (w-web-api test/tools/e2e-setup.mjs:611-625 相同)
async function legacySsoComposeBox(buf, box) {
    let meta = await sharp(buf).metadata()
    let M = 3
    let bl = Math.max(M, box.left - 6)
    let bt = Math.max(M, box.top - 6)
    let br = Math.min(meta.width - M, box.right + 6)
    let bb = Math.min(meta.height - M, box.bottom + 6)
    if (br - bl <= 5 || bb - bt <= 5) {
        return buf
    }
    let svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${bl + 2.5}" y="${bt + 2.5}" width="${br - bl - 5}" height="${bb - bt - 5}" fill="none" stroke="#f26" stroke-width="5" rx="4" ry="4"/>` +
        `</svg>`
    return await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
}

//w-web-perm test/tools/e2e-setup.mjs:462-477 (captureStableWithBox 內之紅框合成; 夾在視窗內)
async function legacyPermCompose(buf, rects, env) {
    let M = 3
    let left = Math.min(...rects.map((r) => r.x)) + env.sx
    let top = Math.min(...rects.map((r) => r.y)) + env.sy
    let right = Math.max(...rects.map((r) => r.x + r.width)) + env.sx
    let bottom = Math.max(...rects.map((r) => r.y + r.height)) + env.sy
    let bl = Math.max(env.sx + M, left - 6)
    let bt = Math.max(env.sy + M, top - 6)
    let br = Math.min(env.sx + env.vw - M, right + 6)
    let bb = Math.min(env.sy + env.vh - M, bottom + 6)
    let meta = await sharp(buf).metadata()
    let svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${bl + 2.5}" y="${bt + 2.5}" width="${br - bl - 5}" height="${bb - bt - 5}" fill="none" stroke="#f26" stroke-width="5" rx="4" ry="4"/>` +
        `</svg>`
    return await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
}

//w-web-sso test/tools/e2e-setup.mjs:588-619 (夾在buffer內; w-web-api :590-606 等價)
async function legacySsoMaskRegions(buf, rects, color = { r: 0, g: 0, b: 0 }) {
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let composite = rects
        .filter((r) => r.w > 0 && r.h > 0)
        .map((r) => {
            let left = Math.max(0, Math.round(r.x))
            let top = Math.max(0, Math.round(r.y))
            let width = Math.min(Math.round(r.w), imgW - left)
            let height = Math.min(Math.round(r.h), imgH - top)
            return { left, top, width, height }
        })
        .filter((c) => c.width > 0 && c.height > 0 && c.left < imgW && c.top < imgH)
        .map((c) => ({ input: { create: { width: c.width, height: c.height, channels: 3, background: color } }, left: c.left, top: c.top }))
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}

//w-web-perm test/tools/e2e-setup.mjs:313-320 (w-web-task test/e2e-setup.mjs:264-271 相同; 未夾邊)
async function legacyPermMaskRegions(buf, rects, color = { r: 0, g: 0, b: 0 }) {
    let composite = rects.filter((r) => r.w > 0 && r.h > 0).map((r) => ({
        input: { create: { width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)), channels: 3, background: color } },
        left: Math.max(0, Math.round(r.x)),
        top: Math.max(0, Math.round(r.y)),
    }))
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}

//w-web-sso test/tools/e2e-setup.mjs:626-644 (w-web-api :632-653 相同)
async function legacySsoOverlayRegions(buf, rects, refBuf) {
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let refMeta = await sharp(refBuf).metadata()
    let composite = []
    for (let r of rects.filter((r) => r.w > 0 && r.h > 0)) {
        let left = Math.max(0, Math.round(r.x))
        let top = Math.max(0, Math.round(r.y))
        let width = Math.min(Math.round(r.w), imgW - left, refMeta.width - left)
        let height = Math.min(Math.round(r.h), imgH - top, refMeta.height - top)
        if (width <= 0 || height <= 0) continue
        let crop = await sharp(refBuf).extract({ left, top, width, height }).png().toBuffer()
        composite.push({ input: crop, left, top })
    }
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}

//w-web-api test/tools/e2e-setup.mjs:659-674
async function legacyApiOverlayImageAt(buf, overlayBuf, left, top) {
    let meta = await sharp(buf).metadata()
    let oMeta = await sharp(overlayBuf).metadata()
    left = Math.max(0, Math.round(left))
    top = Math.max(0, Math.round(top))
    let w = Math.min(oMeta.width, meta.width - left)
    let h = Math.min(oMeta.height, meta.height - top)
    if (w <= 0 || h <= 0) return buf
    let ov = overlayBuf
    if (w !== oMeta.width || h !== oMeta.height) {
        ov = await sharp(overlayBuf).extract({ left: 0, top: 0, width: w, height: h }).png().toBuffer()
    }
    return await sharp(buf).composite([{ input: ov, left, top }]).png().toBuffer()
}

//w-web-api test/tools/e2e-setup.mjs:678-685
async function legacyApiCropRegion(buf, rect) {
    let meta = await sharp(buf).metadata()
    let left = Math.max(0, Math.round(rect.x))
    let top = Math.max(0, Math.round(rect.y))
    let width = Math.min(Math.round(rect.w), meta.width - left)
    let height = Math.min(Math.round(rect.h), meta.height - top)
    return await sharp(buf).extract({ left, top, width, height }).png().toBuffer()
}


//合成測試圖: 底色加數個色塊(可見合成效果), 確定性
async function makeImage(w, h, seed = 1) {
    let blocks = []
    for (let i = 0; i < 12; i++) {
        let bw = 40 + ((seed * 37 + i * 53) % 160)
        let bh = 30 + ((seed * 29 + i * 71) % 120)
        let left = (seed * 97 + i * 131) % Math.max(1, w - bw)
        let top = (seed * 61 + i * 89) % Math.max(1, h - bh)
        let c = { r: (i * 40 + seed * 11) % 256, g: (i * 70 + seed * 23) % 256, b: (i * 110 + seed * 7) % 256 }
        blocks.push({ input: { create: { width: bw, height: bh, channels: 3, background: c } }, left, top })
    }
    return await sharp({ create: { width: w, height: h, channels: 4, background: { r: 245, g: 246, b: 248, alpha: 1 } } }).composite(blocks).png().toBuffer()
}


describe('inkRect: 緊貼墨跡之矩形外擴 INK_PAD', function() {

    it('預設外擴 INK_PAD(4); 可指定 pad(0 即原矩形); 非數值矩形或負 pad 拋錯', function() {
        assert.strict.equal(INK_PAD, 4)
        assert.deepStrictEqual(inkRect({ x: 10, y: 20, width: 30, height: 12 }), { x: 6, y: 16, width: 38, height: 20 })
        assert.deepStrictEqual(inkRect({ x: 10, y: 20, width: 30, height: 12 }, 0), { x: 10, y: 20, width: 30, height: 12 })
        assert.deepStrictEqual(inkRect({ x: 10.5, y: 0, width: 1, height: 1 }, 2), { x: 8.5, y: -2, width: 5, height: 5 })
        assert.throws(() => inkRect(null), /inkRect: rect 須為/)
        assert.throws(() => inkRect({ x: 1, y: 2, width: 3 }), /inkRect: rect 須為/)
        assert.throws(() => inkRect({ x: 1, y: 2, width: 3, height: 4 }, -1), /inkRect: pad 須為非負數/)
    })

    it('neighbors: 框線中心不越過與鄰項間隙之正中(框線中心在目標邊外 BOX_PAD 6 - BOX_STROKE/2 2.5 = 3.5); 不相鄰者不影響', function() {
        let item = { x: 100, y: 10, width: 60, height: 12 }
        //右鄰間隙 4px(目標右緣 160、鄰項左緣 164): 中點 162 → 右緣 ≤ 162 - 3.5 = 158.5(原外擴 164 → 收), 框線中心落在中點
        let r = inkRect(item, { neighbors: [{ x: 164, y: 10, width: 50, height: 12 }] })
        assert.deepStrictEqual(r, { x: 96, y: 6, width: 62.5, height: 20 })
        //左鄰遠(間隙 40): 中點 80 → 左緣 ≥ 83.5, 原外擴 96 不受影響; 不同列(無垂直重疊)者不影響
        let r2 = inkRect(item, { pad: 4, neighbors: [{ x: 0, y: 10, width: 60, height: 12 }, { x: 100, y: 200, width: 60, height: 12 }] })
        assert.deepStrictEqual(r2, { x: 96, y: 6, width: 68, height: 20 })
    })

})


describe('composeBox 與現行實作等價', function() {

    let img = null
    let tall = null
    before(async function() {
        img = await makeImage(1280, 720, 1)
        tall = await makeImage(1280, 1000, 2)
    })

    let boxes = [
        { left: 226, top: 178, right: 1275, bottom: 716 }, //近乎整個表格(貼右下邊界)
        { left: 825, top: 412, right: 984, bottom: 450 }, //儲存格
        { left: 388, top: 139, right: 432, bottom: 184 }, //圓鈕
        { left: -20, top: -15, right: 60, bottom: 40 }, //超出左上
        { left: 1250, top: 700, right: 1400, bottom: 800 }, //超出右下
        { left: 100, top: 100, right: 102, bottom: 102 }, //過小(外擴後仍可畫)
        { left: 1279, top: 719, right: 1280, bottom: 720 }, //貼角落過小(夾邊後不畫)
    ]

    it('預設(夾在buffer內)與sso/api之composeBox逐位元相同', async function() {
        for (let box of boxes) {
            let a = await composeBox(img, box)
            let b = await legacySsoComposeBox(img, box)
            assert.strict.ok(a.equals(b), `box=${JSON.stringify(box)}`)
        }
    })

    it('bounds為視窗矩形時與perm之紅框合成逐位元相同(含頁高大於視窗)', async function() {
        let cases = [
            { buf: img, env: { sx: 0, sy: 0, vw: 1280, vh: 720 }, rects: [{ x: 226, y: 178, width: 1049, height: 538 }] },
            { buf: img, env: { sx: 0, sy: 0, vw: 1280, vh: 720 }, rects: [{ x: 825, y: 412, width: 159, height: 38 }, { x: 990, y: 300, width: 100, height: 20 }] },
            { buf: tall, env: { sx: 0, sy: 0, vw: 1280, vh: 720 }, rects: [{ x: 200, y: 600, width: 400, height: 300 }] }, //框超出視窗底
            { buf: tall, env: { sx: 0, sy: 200, vw: 1280, vh: 720 }, rects: [{ x: 50, y: 10, width: 300, height: 100 }] }, //已捲動
        ]
        for (let c of cases) {
            let box = {
                left: Math.min(...c.rects.map((r) => r.x)) + c.env.sx,
                top: Math.min(...c.rects.map((r) => r.y)) + c.env.sy,
                right: Math.max(...c.rects.map((r) => r.x + r.width)) + c.env.sx,
                bottom: Math.max(...c.rects.map((r) => r.y + r.height)) + c.env.sy,
            }
            let bounds = { left: c.env.sx, top: c.env.sy, right: c.env.sx + c.env.vw, bottom: c.env.sy + c.env.vh }
            let a = await composeBox(c.buf, box, { bounds })
            let b = await legacyPermCompose(c.buf, c.rects, c.env)
            assert.strict.ok(a.equals(b), `case=${JSON.stringify(c.env)} ${JSON.stringify(c.rects)}`)
        }
    })

    it('框過小時回傳原buffer(同一物件)', async function() {
        let a = await composeBox(img, { left: 1279, top: 719, right: 1280, bottom: 720 })
        assert.strict.ok(a === img)
    })

    it('guardSmall=false 時與 perm(無過小守門)之紅框合成行為相同(夾邊後過小之框)', async function() {
        let env = { sx: 0, sy: 0, vw: 1280, vh: 720 }
        let rects = [{ x: 1279, y: 719, width: 1, height: 1 }]
        let box = { left: 1279, top: 719, right: 1280, bottom: 720 }
        let bounds = { left: 0, top: 0, right: 1280, bottom: 720 }
        let run = async (fn) => {
            try {
                return { buf: await fn() }
            }
            catch (err) {
                return { err: String(err && err.message) }
            }
        }
        let a = await run(() => composeBox(img, box, { bounds, guardSmall: false }))
        let b = await run(() => legacyPermCompose(img, rects, env))
        if (a.err || b.err) {
            assert.strict.deepStrictEqual(a.err, b.err)
        }
        else {
            assert.strict.ok(a.buf.equals(b.buf))
        }
    })

})


describe('maskRegions 與現行實作等價', function() {

    let img = null
    before(async function() {
        img = await makeImage(1280, 720, 3)
    })

    it('界內與越界矩形皆與sso/api之maskRegions逐位元相同', async function() {
        let sets = [
            [{ x: 10, y: 20, w: 100, h: 30 }],
            [{ x: 10.4, y: 20.6, w: 99.5, h: 30.2 }, { x: 600, y: 300, w: 40, h: 40 }],
            [{ x: 1200, y: 700, w: 200, h: 100 }], //越界(夾邊)
            [{ x: -30, y: -10, w: 100, h: 50 }], //負座標
            [{ x: 0, y: 0, w: 0, h: 10 }, { x: 5, y: 5, w: 10, h: -1 }], //寬高非正(略過)
        ]
        for (let rs of sets) {
            let a = await maskRegions(img, rs)
            let b = await legacySsoMaskRegions(img, rs)
            assert.strict.ok(a.equals(b), JSON.stringify(rs))
        }
    })

    it('界內且寬高至少1像素之矩形與perm/task之maskRegions逐位元相同', async function() {
        let sets = [
            [{ x: 10, y: 20, w: 100, h: 30 }],
            [{ x: 100.2, y: 200.7, w: 50.4, h: 20.5 }, { x: 900, y: 500, w: 120, h: 80 }],
        ]
        for (let rs of sets) {
            let a = await maskRegions(img, rs)
            let b = await legacyPermMaskRegions(img, rs)
            assert.strict.ok(a.equals(b), JSON.stringify(rs))
        }
    })

    it('填色參數有效', async function() {
        let a = await maskRegions(img, [{ x: 0, y: 0, w: 5, h: 5 }], { r: 255, g: 0, b: 0 })
        let { data, info } = await sharp(a).raw().toBuffer({ resolveWithObject: true })
        let i = (2 * info.width + 2) * info.channels
        assert.strict.deepStrictEqual([data[i], data[i + 1], data[i + 2]], [255, 0, 0])
    })

    it('無有效矩形時回傳原buffer(同一物件)', async function() {
        assert.strict.ok((await maskRegions(img, [])) === img)
        assert.strict.ok((await maskRegions(img, [{ x: 2000, y: 2000, w: 10, h: 10 }])) === img)
    })

})


describe('overlayRegions/overlayImageAt/cropRegion 與現行實作等價', function() {

    let img = null
    let ref = null
    before(async function() {
        img = await makeImage(1280, 720, 4)
        ref = await makeImage(1280, 720, 5)
    })

    it('overlayRegions與sso/api逐位元相同(含越界夾邊、ref較小)', async function() {
        let smallRef = await makeImage(800, 400, 6)
        let sets = [
            { rects: [{ x: 240, y: 330, w: 1000, h: 380 }], r: ref },
            { rects: [{ x: 1200, y: 600, w: 300, h: 300 }, { x: 10, y: 10, w: 50, h: 50 }], r: ref },
            { rects: [{ x: 700, y: 300, w: 300, h: 300 }], r: smallRef }, //ref較小: 夾在ref內
        ]
        for (let s of sets) {
            let a = await overlayRegions(img, s.rects, s.r)
            let b = await legacySsoOverlayRegions(img, s.rects, s.r)
            assert.strict.ok(a.equals(b), JSON.stringify(s.rects))
        }
    })

    it('overlayImageAt與api逐位元相同(含超出邊界裁切); 完全在圖外回傳原buffer', async function() {
        let piece = await makeImage(300, 200, 7)
        for (let [l, t] of [[100, 100], [1100, 600], [-10, 5.6]]) {
            let a = await overlayImageAt(img, piece, l, t)
            let b = await legacyApiOverlayImageAt(img, piece, l, t)
            assert.strict.ok(a.equals(b), `${l},${t}`)
        }
        assert.strict.ok((await overlayImageAt(img, piece, 1280, 10)) === img)
    })

    it('cropRegion與api逐位元相同(含越界夾邊)', async function() {
        for (let r of [{ x: 240, y: 330, w: 1000, h: 380 }, { x: 1200, y: 700, w: 300, h: 300 }, { x: -5, y: -5, w: 50, h: 50 }]) {
            let a = await cropRegion(img, r)
            let b = await legacyApiCropRegion(img, r)
            assert.strict.ok(a.equals(b), JSON.stringify(r))
        }
    })

})
