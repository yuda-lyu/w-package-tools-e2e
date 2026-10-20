//itemsUnionBox 圖形內容(svg 圖形 / 2d canvas 像素 / graphicAreas 宣告區)測試——對應 CLAUDE_rulebook.md 表 C(§7.2), 標題前綴 [ID] 即格類 ID
//斷言之真理源為「無圖形內容時之量框」(blank 基線)與「框線外緣 <= 內容近緣」之幾何關係, 不引用實作之內部數值;
//框線 = 量測矩形各邊外擴 BOX_PAD(6)px、描邊寬 BOX_STROKE(5)px, 故框線帶 = 矩形邊外 1 至 6px
import assert from 'assert'
import launchBrowser from '../src/launchBrowser.mjs'
import itemsUnionBox from '../src/itemsUnionBox.mjs'

//浮層: fixed, 左 300 上 150 寬 120(底 216、右 420), 兩項文字(padding 7px 8px)
let POP = { l: 300, t: 150, w: 120 }
let popHtml = (style = '') => `<div id="pop" style="position:fixed;z-index:20;left:${POP.l}px;top:${POP.t}px;width:${POP.w}px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif;${style}"><div tabindex="0" style="padding:7px 8px">OR</div><div tabindex="0" style="padding:7px 8px">AND</div></div>`
let SV = { l: 20, t: 60, w: 760, h: 300 }
let svgOpen = (attr = '', style = '') => `<svg id="chart" style="position:absolute;left:${SV.l}px;top:${SV.t}px;${style}" width="${SV.w}" height="${SV.h}" ${attr}><rect id="bgrect" width="${SV.w}" height="${SV.h}" fill="#fff"/>`
//視窗座標 → svg 座標
let sx = (x) => x - SV.l
let sy = (y) => y - SV.t
//下緣下方 g px 之 1px 水平線(視窗 y = 216 + g + 0.5; 內容上緣 = 216 + g)
let POP_BOTTOM = 216
let lineAt = (g, extra = '', w = 1) => `<path d="M${sx(160)} ${sy(POP_BOTTOM + g + w / 2)} L${sx(560)} ${sy(POP_BOTTOM + g + w / 2)}" stroke="#c00" stroke-width="${w}" fill="none" ${extra}/>`
let rectOf = (r) => ({ l: r.x, t: r.y, r: r.x + r.width, b: r.y + r.height })

describe('itemsUnionBox 圖形內容(svg 圖形、canvas 像素、graphicAreas)', function() {
    this.timeout(120000)
    let browser = null
    let page = null
    before(async function() {
        browser = await launchBrowser()
        page = await (await browser.newContext({ viewport: { width: 800, height: 420 } })).newPage()
    })
    after(async function() {
        await browser.close()
    })

    let load = async (html) => {
        await page.setContent(`<body style="margin:0">${html}</body>`)
    }
    let measure = async (opt = {}, sel = '#pop') => rectOf(await itemsUnionBox(sel, { fit: true, ...opt }).measure(page))
    //文字內容下緣(浮層內容範圍 inner.bottom)
    let innerBottom = async () => page.evaluate(() => {
        let b = 0
        for (let d of document.querySelectorAll('#pop > div')) {
            let rg = document.createRange()
            rg.selectNodeContents(d)
            b = Math.max(b, rg.getBoundingClientRect().bottom)
        }
        return b
    })
    //量測期間 document.elementsFromPoint 之呼叫次數(以 graphics 開關對照: 無圖形頁面不得因圖形規則而增加取樣成本)
    let countEfp = async (graphics) => {
        await page.evaluate(() => {
            window.__efp = 0
            if (!window.__efpPatched) {
                let o = document.elementsFromPoint.bind(document)
                document.elementsFromPoint = (x, y) => {
                    window.__efp++
                    return o(x, y)
                }
                window.__efpPatched = true
            }
        })
        await itemsUnionBox('#pop', { fit: true, graphics }).measure(page)
        return page.evaluate(() => window.__efp)
    }

    //無圖形內容之基線(同一浮層、頁面無其他內容)
    let blank = async (opt = {}) => {
        await load(popHtml())
        return measure(opt)
    }
    //期望「退入」: 框線外緣(下緣 + 6)不越過內容上緣, 且框仍包住文字(下緣 ≥ 文字下緣)、確實退入浮層內
    let expectAvoidsBottom = async (label, contentTop, opt = {}) => {
        let r = await measure(opt)
        let ib = await innerBottom()
        assert.ok(r.b + 6 <= contentTop, `${label}: 框線外緣 ${r.b + 6} 須 ≤ 內容上緣 ${contentTop}`)
        assert.ok(r.b + 1 >= ib, `${label}: 框仍包住文字(框線內緣 ${r.b + 1} ≥ 文字下緣 ${ib})`)
        assert.ok(r.b < POP_BOTTOM, `${label}: 框線退入浮層內距(下緣 ${r.b} < 浮層下緣 ${POP_BOTTOM})`)
        return r
    }
    //期望「不動」: 與無圖形內容之基線逐位元相同
    let expectSameAsBlank = async (label, html, opt = {}) => {
        let base = await blank(opt)
        await load(html)
        assert.deepStrictEqual(await measure(opt), base, `${label}: 應與無圖形內容時之量框相同`)
    }

    describe('[C0x] 無內容/大型純色/既有 HTML 規則(不變)', function() {
        it('[C01] 無任何內容: 四周空白照常外擴(下緣 = 浮層下緣 216)', async function() {
            await load(popHtml())
            assert.strictEqual((await measure()).b, POP_BOTTOM)
        })
        it('[C02] 四周為純色大 div(寬 > 480): 不當內容, 同無內容', async function() {
            await expectSameAsBlank('純色大 div', `<div style="position:absolute;left:20px;top:150px;width:760px;height:110px;background:#eef"></div>` + popHtml())
        })
        it('[C15] svg 內撐滿之底色 rect(≥ 50% 面積)不算內容; 只有底色矩形之 svg 同無內容', async function() {
            await expectSameAsBlank('svg 僅底色 rect', svgOpen() + '</svg>' + popHtml())
        })
    })

    describe('[C04–C14] svg 圖形(可見): 緊貼浮層下緣(間隙 2px)時框線退入, 不蓋圖形', function() {
        let cases = {
            'C04 path stroke 1px': (g) => lineAt(g),
            'C05 line 1.5px': (g) => `<line x1="${sx(160)}" y1="${sy(POP_BOTTOM + g + 0.75)}" x2="${sx(560)}" y2="${sy(POP_BOTTOM + g + 0.75)}" stroke="#c00" stroke-width="1.5"/>`,
            'C06 polyline': (g) => `<polyline points="${sx(160)},${sy(POP_BOTTOM + g + 0.5)} ${sx(360)},${sy(POP_BOTTOM + g + 0.5)} ${sx(560)},${sy(POP_BOTTOM + g + 0.5)}" stroke="#c00" stroke-width="1" fill="none"/>`,
            'C07 polygon fill(無 stroke)': (g) => `<polygon points="${sx(160)},${sy(POP_BOTTOM + g)} ${sx(560)},${sy(POP_BOTTOM + g)} ${sx(560)},${sy(POP_BOTTOM + g + 2)} ${sx(160)},${sy(POP_BOTTOM + g + 2)}" fill="#c00"/>`,
            'C08 rect fill(長條)': (g) => `<rect x="${sx(160)}" y="${sy(POP_BOTTOM + g)}" width="400" height="3" fill="#c00"/>`,
            'C09 circle 標記列': (g) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<circle cx="${sx(160 + i * 44)}" cy="${sy(POP_BOTTOM + g + 3)}" r="3" fill="#c00"/>`).join(''),
            'C12 群組 transform(translate+scale)': (g) => `<g transform="translate(10,5) scale(2,1)"><path d="M${(sx(160) - 10) / 2} ${sy(POP_BOTTOM + g + 0.5) - 5} L${(sx(560) - 10) / 2} ${sy(POP_BOTTOM + g + 0.5) - 5}" stroke="#c00" stroke-width="1" fill="none"/></g>`,
            'C13 透明追蹤線覆在線上(Highcharts tracker)': (g) => lineAt(g) + `<path d="M${sx(160)} ${sy(POP_BOTTOM + g + 0.5)} L${sx(560)} ${sy(POP_BOTTOM + g + 0.5)}" stroke="rgba(192,192,192,0.0001)" stroke-width="22" fill="none"/>`,
            'C14 pointer-events:none 之線(Plotly .main-svg)': (g) => `<g pointer-events="none">${lineAt(g)}</g>`,
            'C18 stroke 為漸層 url(#g)': (g) => `<defs><linearGradient id="gr"><stop offset="0" stop-color="#c00"/><stop offset="1" stop-color="#c00"/></linearGradient></defs>` + lineAt(g, 'stroke="url(#gr)"').replace('stroke="#c00" ', ''),
        }
        for (let [name, fn] of Object.entries(cases)) {
            it(`[${name}] 間隙 2px`, async function() {
                await load(svgOpen() + fn(2) + '</svg>' + popHtml())
                await expectAvoidsBottom(name, POP_BOTTOM + 2)
            })
        }
        it('[C12b] svg 位於 CSS scale(1.5) 容器內', async function() {
            await load(`<div style="position:absolute;left:20px;top:60px;transform:scale(1.5);transform-origin:0 0"><svg width="500" height="200"><rect width="500" height="200" fill="#fff"/><path d="M0 ${(POP_BOTTOM + 2.5 - 60) / 1.5} L500 ${(POP_BOTTOM + 2.5 - 60) / 1.5}" stroke="#c00" stroke-width="${1 / 1.5}"/></svg></div>` + popHtml())
            await expectAvoidsBottom('CSS scale', POP_BOTTOM + 2)
        })
        it('[C12c] 巢狀 svg(內層 svg 含線)', async function() {
            await load(svgOpen() + `<svg x="100" y="100" width="500" height="150" viewBox="0 0 500 150"><path d="M0 ${sy(POP_BOTTOM + 2.5) - 100} L500 ${sy(POP_BOTTOM + 2.5) - 100}" stroke="#c00" fill="none"/></svg></svg>` + popHtml())
            await expectAvoidsBottom('巢狀 svg', POP_BOTTOM + 2)
        })
        it('[C10] 可命中之 svg 文字(Highcharts 軸標籤、數據標籤): 舊規則已處理, 結果不變(仍退入)', async function() {
            await load(svgOpen() + `<text x="${sx(300)}" y="${sy(POP_BOTTOM + 14)}" font-size="12" fill="#c00">WWWWWWWWWWWWWWWWWWWW</text></svg>` + popHtml())
            let r = await measure()
            assert.ok(r.b < POP_BOTTOM, `文字在浮層下緣下方 2px 內: 框須退入(實得下緣 ${r.b})`)
        })
        it('[C11] pointer-events:none 之 svg 文字(Plotly 刻度標籤)', async function() {
            await load(svgOpen() + `<text x="${sx(300)}" y="${sy(POP_BOTTOM + 14)}" font-size="12" fill="#c00" pointer-events="none">WWWWWWWWWWWWWWWWWWWW</text></svg>` + popHtml())
            let r = await measure()
            assert.ok(r.b < POP_BOTTOM, `文字在浮層下緣下方 2px 內: 框須退入(實得下緣 ${r.b})`)
        })
        it('[C04b] 不透明度 0.5 之 svg 根: 仍算內容', async function() {
            await load(svgOpen('', 'opacity:.5') + lineAt(2) + '</svg>' + popHtml())
            await expectAvoidsBottom('opacity .5', POP_BOTTOM + 2)
        })
    })

    describe('[C17] svg 圖形(不可見): 不算內容, 同無內容', function() {
        let invis = {
            'stroke alpha 0': 'stroke="rgba(204,0,0,0)" stroke-width="1.5"',
            'stroke-opacity 0': 'stroke="#c00" stroke-width="1.5" stroke-opacity="0"',
            'opacity 0': 'stroke="#c00" stroke-width="1.5" opacity="0"',
            'display none': 'stroke="#c00" stroke-width="1.5" display="none"',
            'visibility hidden': 'stroke="#c00" stroke-width="1.5" visibility="hidden"',
            'stroke none + fill none': 'stroke="none"',
            'stroke-width 0': 'stroke="#c00" stroke-width="0"',
        }
        for (let [name, attrs] of Object.entries(invis)) {
            it(`[C17] ${name}`, async function() {
                let p = `<path d="M${sx(160)} ${sy(POP_BOTTOM + 2.5)} L${sx(560)} ${sy(POP_BOTTOM + 2.5)}" fill="none" ${attrs}/>`
                await expectSameAsBlank(name, svgOpen() + p + '</svg>' + popHtml())
            })
        }
        it('[C17] 祖先 opacity 0', async function() {
            await expectSameAsBlank('祖先 opacity 0', svgOpen() + `<g opacity="0">${lineAt(2)}</g></svg>` + popHtml())
        })
        it('[C17] 根 opacity .05(累積 < 0.1)', async function() {
            await expectSameAsBlank('根 opacity .05', svgOpen('', 'opacity:.05') + lineAt(2) + '</svg>' + popHtml())
        })
        it('[C17] svg 根 display:none', async function() {
            await expectSameAsBlank('根 display none', svgOpen('display="none"') + lineAt(2) + '</svg>' + popHtml())
        })
        it('[C17] 被 clip-path 裁掉之圖形(Highcharts 繪圖區裁切)', async function() {
            await expectSameAsBlank('clip-path 裁掉', svgOpen() + `<clipPath id="cp"><rect x="0" y="0" width="30" height="30"/></clipPath><g clip-path="url(#cp)">${lineAt(2)}</g></svg>` + popHtml())
        })
        it('[C17] 位於 <defs> 內', async function() {
            await expectSameAsBlank('defs 內', svgOpen() + `<defs>${lineAt(2)}</defs></svg>` + popHtml())
        })
    })

    describe('[D0x] 位置: 緊貼/間隔/方向(最小介入——只在框線帶內才介入)', function() {
        //框線帶 = 矩形邊外 1 至 6px(浮層下緣 216 → 像素列 217–221 與帶相交); 另掃緊鄰矩形邊之一列(g=0, 守距: 與框線內緣相切, 且攔下延伸至框線四角之縱橫向內容)
        for (let g of [0, 2, 5]) {
            it(`[D0${[0, 2, 5].indexOf(g) + 1}] 下方線距浮層下緣 ${g}px(框線帶內或緊鄰守距列): 退入`, async function() {
                await load(svgOpen() + lineAt(g) + '</svg>' + popHtml())
                await expectAvoidsBottom(`g=${g}`, POP_BOTTOM + g)
            })
        }
        for (let g of [6, 8, 12, 30]) {
            it(`[D04] 下方線距浮層下緣 ${g}px(超出框線帶 6px): 與無內容逐位元相同(既有標準圖不動)`, async function() {
                await expectSameAsBlank(`g=${g}`, svgOpen() + lineAt(g) + '</svg>' + popHtml())
            })
        }
        it('[D05] 上/左/右方向之線(緊貼 2px): 各邊退入, 框線外緣不越過內容', async function() {
            let seg = (side) => {
                let c = side === 'top' ? POP.t - 2.5 : side === 'right' ? POP.l + POP.w + 2.5 : POP.l - 2.5
                let h = side === 'top'
                return h ? `<path d="M${sx(160)} ${sy(c)} L${sx(560)} ${sy(c)}" stroke="#c00" fill="none"/>` : `<path d="M${sx(c)} ${sy(100)} L${sx(c)} ${sy(300)}" stroke="#c00" fill="none"/>`
            }
            for (let side of ['top', 'left', 'right']) {
                await load(svgOpen() + seg(side) + '</svg>' + popHtml())
                let r = await measure()
                if (side === 'top') {
                    assert.ok(r.t - 6 >= POP.t - 2, `top: 框線外緣 ${r.t - 6} 須 ≥ 內容下緣 ${POP.t - 2}`)
                }
                else if (side === 'left') {
                    assert.ok(r.l - 6 >= POP.l - 2, `left: 框線外緣 ${r.l - 6} 須 ≥ 內容右緣 ${POP.l - 2}`)
                }
                else {
                    assert.ok(r.r + 6 <= POP.l + POP.w + 2, `right: 框線外緣 ${r.r + 6} 須 ≤ 內容左緣 ${POP.l + POP.w + 2}`)
                }
            }
        })
        it('[D06] 浮層比文字寬: 線橫貫下緣右半(文字範圍之外)仍退入(沿框線全長取樣, 非只取內容範圍)', async function() {
            await load(svgOpen() + `<path d="M${sx(380)} ${sy(POP_BOTTOM + 2.5)} L${sx(560)} ${sy(POP_BOTTOM + 2.5)}" stroke="#c00" fill="none"/></svg>` + popHtml())
            await expectAvoidsBottom('線只在浮層右半下方', POP_BOTTOM + 2)
        })
        it('[D07] 水平線在浮層下方(橫向延伸至左右側外): 只退下緣, 左右緣不縮', async function() {
            await load(svgOpen() + lineAt(0) + '</svg>' + popHtml())
            let r = await measure()
            let base = await blank()
            assert.strictEqual(r.l, base.l, '左緣不縮')
            assert.strictEqual(r.r, base.r, '右緣不縮')
        })
    })

    describe('[E0x] 遮蓋: 看不見之圖形不算(同舊規則③④)', function() {
        let svgLine = () => svgOpen() + lineAt(2) + '</svg>'
        it('[E01] 淡底全畫面遮罩(z 10 < 浮層 z 20)之後: 不算內容', async function() {
            await expectSameAsBlank('遮罩後', svgLine() + `<div style="position:fixed;z-index:10;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,.3)"></div>` + popHtml())
        })
        it('[E02] 透明全畫面點擊攔截層之後: 穿透, 算內容', async function() {
            await load(svgLine() + `<div style="position:fixed;z-index:10;left:0;top:0;width:100vw;height:100vh"></div>` + popHtml())
            await expectAvoidsBottom('攔截層穿透', POP_BOTTOM + 2)
        })
        it('[E03] 不透明 div 蓋在圖形上: 圖形不算(該 div 之內容判定依舊規則)', async function() {
            //div 為有可見邊界之元素 → 舊規則已視為內容; 此處以「div 在下方 30px 以外」排除其影響, 圖形被另一不透明 div 蓋住
            await expectSameAsBlank('被不透明 div 蓋住', svgLine() + `<div style="position:absolute;left:140px;top:210px;width:440px;height:30px;background:#fff"></div>` + popHtml())
        })
        it('[E04] 浮層自身含大 svg: 不算外部內容', async function() {
            await load(popHtml().replace('<div tabindex="0" style="padding:7px 8px">OR</div>', '<svg width="120" height="30"><path d="M0 15 L120 15" stroke="#c00" stroke-width="2"/></svg><div tabindex="0" style="padding:7px 8px">OR</div>'))
            let base = await measure()
            assert.ok(base.b >= POP_BOTTOM, '浮層底部無外部內容: 照常外擴')
        })
    })

    describe('[F0x] 選項', function() {
        it('[F01] fit:false: 不受圖形內容影響(量元素本身)', async function() {
            await load(svgOpen() + lineAt(2) + '</svg>' + popHtml())
            let r = rectOf(await itemsUnionBox('#pop', { fit: false }).measure(page))
            assert.deepStrictEqual(r, { l: POP.l, t: POP.t, r: POP.l + POP.w, b: POP_BOTTOM })
        })
        it('[F02] graphics:false: 與無圖形偵測逐位元相同(升版後可關閉以重現 1.0.9)', async function() {
            await expectSameAsBlank('graphics:false', svgOpen() + lineAt(2) + '</svg>' + popHtml(), { graphics: false })
        })
        it('[F03] 預設啟用 svg 圖形偵測(不需旗標)', async function() {
            await load(svgOpen() + lineAt(2) + '</svg>' + popHtml())
            assert.ok((await measure()).b < POP_BOTTOM)
        })
    })

    describe('[G0x] canvas / img / 宣告區', function() {
        let cv = (draw, style = '') => `<canvas id="cv" style="position:absolute;left:20px;top:60px;${style}" width="760" height="300"></canvas><script>(function(){var c=document.getElementById('cv');${draw}})()</script>`
        let redLine = `var x=c.getContext('2d');x.strokeStyle='#c00';x.lineWidth=1;x.beginPath();x.moveTo(140,${POP_BOTTOM + 2.5 - 60});x.lineTo(540,${POP_BOTTOM + 2.5 - 60});x.stroke();`
        let white = `var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,760,300);`
        it('[G01] canvas 2d 透明底 + 線(緊貼 2px): 退入', async function() {
            await load(cv(redLine) + popHtml())
            await expectAvoidsBottom('canvas 透明底', POP_BOTTOM + 2)
        })
        it('[G02] canvas 2d 不透明白底 + 線: 退入; 同畫布無線: 同無內容(不把整片白底當內容)', async function() {
            await load(cv(white + redLine) + popHtml())
            await expectAvoidsBottom('canvas 白底+線', POP_BOTTOM + 2)
            await expectSameAsBlank('canvas 白底無線', cv(white) + popHtml())
        })
        it('[G03] canvas 2d 透明底空白: 同無內容', async function() {
            await expectSameAsBlank('canvas 空白', cv('') + popHtml())
        })
        it('[G04] canvas 2d 不透明紋理(地圖式): 全區視為內容 → 四邊退入', async function() {
            await load(cv(`var x=c.getContext('2d');for(var i=0;i<760;i+=8){for(var j=0;j<300;j+=8){x.fillStyle='hsl('+((i*7+j*13)%360)+',60%,'+(30+((i+j)%40))+'%)';x.fillRect(i,j,8,8)}}`) + popHtml())
            let r = await measure()
            let base = await blank()
            assert.ok(r.b < base.b && r.t > base.t && r.l > base.l && r.r < base.r, `四邊皆退入(實得 ${JSON.stringify(r)} vs 基線 ${JSON.stringify(base)})`)
        })
        it('[G05] WebGL canvas(讀不到像素): 預設同無內容(不判定); graphicAreas 宣告後視為內容', async function() {
            let gl = cv(`var gl=c.getContext('webgl');gl.clearColor(0.8,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);`) + popHtml()
            await expectSameAsBlank('webgl 預設', gl)
            await load(gl)
            let r = await measure({ graphicAreas: '#cv' })
            assert.ok(r.b < POP_BOTTOM && r.t > POP.t, `宣告後四邊退入(實得 ${JSON.stringify(r)})`)
        })
        it('[G06] 跨域污染 canvas(getImageData 拋 SecurityError): 不拋錯, 預設同無內容', async function() {
            await page.route('http://other.invalid/img.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#c00"/></svg>' }))
            let base = await blank()
            await load(cv(`var img=new Image();img.onload=function(){c.getContext('2d').drawImage(img,140,${POP_BOTTOM + 2 - 60},400,4);window.__done=true};img.src='http://other.invalid/img.svg';`) + popHtml())
            await page.waitForFunction(() => window.__done === true)
            let tainted = await page.evaluate(() => {
                try {
                    document.getElementById('cv').getContext('2d').getImageData(0, 0, 1, 1)
                    return ''
                }
                catch (e) {
                    return e.name
                }
            })
            assert.strictEqual(tainted, 'SecurityError', '前提: canvas 確已被跨域圖污染')
            assert.deepStrictEqual(await measure(), base)
            await page.unroute('http://other.invalid/img.svg')
        })
        it('[G07] img: 預設同無內容; graphicAreas:"img" 宣告後退入(含陣列、無命中之選擇器不影響)', async function() {
            let img = `<img id="im" src="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="760" height="300"><rect width="760" height="300" fill="#fff"/></svg>')}" style="position:absolute;left:20px;top:60px" width="760" height="300">` + popHtml()
            await expectSameAsBlank('img 預設', img)
            await load(img)
            let r1 = await measure({ graphicAreas: 'img' })
            let r2 = await measure({ graphicAreas: ['#none', 'img'] })
            let base = await blank()
            assert.ok(r1.b < base.b, '宣告 img 後退入')
            assert.deepStrictEqual(r2, r1, '陣列與字串同果; 無命中之選擇器不影響')
        })
        it('[G08] graphicAreas 區位於浮層內: 不算; 被淡底遮罩蓋住: 不算', async function() {
            await expectSameAsBlank('區在浮層內', `<div id="in" style="position:fixed;left:${POP.l}px;top:${POP.t}px;width:${POP.w}px;height:66px;z-index:19"></div>` + popHtml(), { graphicAreas: '#in' })
            await expectSameAsBlank('區被遮罩蓋住', `<div id="big" style="position:absolute;left:20px;top:60px;width:760px;height:300px"></div><div style="position:fixed;z-index:10;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,.3)"></div>` + popHtml(), { graphicAreas: '#big' })
        })
        it('[G09] svg <use> 與 <image> 不自動判定(限制; 同無內容), <image> 可由 graphicAreas:"svg image" 宣告', async function() {
            await expectSameAsBlank('<use>', svgOpen() + `<defs><path id="u" d="M${sx(160)} ${sy(POP_BOTTOM + 2.5)} L${sx(560)} ${sy(POP_BOTTOM + 2.5)}" stroke="#c00" fill="none"/></defs><use href="#u"/></svg>` + popHtml())
            let im = svgOpen() + `<image href="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="20"><rect width="400" height="20" fill="#c00"/></svg>')}" x="${sx(160)}" y="${sy(POP_BOTTOM + 2)}" width="400" height="20"/></svg>` + popHtml()
            await expectSameAsBlank('<image> 預設', im)
            await load(im)
            assert.ok((await measure({ graphicAreas: 'svg image' })).b < POP_BOTTOM)
        })
        it('[G10] graphicAreas 非法(空字串、非字串)拋錯', async function() {
            assert.throws(() => itemsUnionBox('#pop', { graphicAreas: '' }), /graphicAreas/)
            assert.throws(() => itemsUnionBox('#pop', { graphicAreas: [1] }), /graphicAreas/)
            assert.throws(() => itemsUnionBox('#pop', { graphicAreas: ['#a', ' '] }), /graphicAreas/)
        })
    })

    describe('[H0x] 結構', function() {
        it('[H01] 透明 fixed 外層 + 有底色面板(元件庫常見結構)之下方有線: 退入', async function() {
            await load(svgOpen() + lineAt(2) + '</svg>' + `<div id="wrap" style="position:fixed;z-index:20;left:300px;top:150px"><div style="padding:7px 8px;width:104px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div>OR</div><div style="margin-top:14px">AND</div></div></div>`)
            let r = rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page))
            assert.ok(r.b + 6 <= POP_BOTTOM + 2, `框線外緣 ${r.b + 6} ≤ 內容上緣 ${POP_BOTTOM + 2}`)
        })
        it('[H02] 同時有 HTML 晶片(右側緊鄰)與 svg 線(下方): 兩者皆避開', async function() {
            await load(svgOpen() + lineAt(2) + '</svg>' + `<div id="chip" style="position:absolute;left:424px;top:160px;width:60px;height:24px;background:#eee;border:1px solid #bbb;box-sizing:border-box">P2</div>` + popHtml())
            let r = await measure()
            assert.ok(r.b + 6 <= POP_BOTTOM + 2, `下: 框線外緣 ${r.b + 6} ≤ 線上緣 ${POP_BOTTOM + 2}`)
            assert.ok(r.r + 6 <= 424, `右: 框線外緣 ${r.r + 6} ≤ 晶片左緣 424`)
        })
        it('[H03] 頁面已捲動(scrollY=100)之視窗座標', async function() {
            await load(`<div style="height:160px"></div><svg width="760" height="300" style="display:block;margin-left:20px"><rect width="760" height="300" fill="#fff"/><path d="M180 258.5 L540 258.5" stroke="#c00" fill="none"/></svg><div style="height:1200px"></div>` + popHtml().replace('top:150px', 'top:250px'))
            await page.evaluate(() => window.scrollTo(0, 100))
            let r = rectOf(await itemsUnionBox('#pop', { fit: true }).measure(page))
            assert.ok(r.b + 6 <= 318, `捲動後框線外緣 ${r.b + 6} ≤ 線上緣 318`)
        })
        it('[H04] position:absolute 之浮層(非 fixed): 浮層規則不適用(既有限制, 不在本次範圍)', async function() {
            await load(svgOpen() + lineAt(2) + '</svg>' + popHtml().replace('position:fixed', 'position:absolute'))
            assert.strictEqual((await measure()).b, POP_BOTTOM)
        })
    })

    describe('[J0x] 補強(變異驗證揭出之缺口)', function() {
        it('[J01] 細於 1px 之線落在像素邊界(0.6px, 區間 [218.6, 219.2]): 取樣足跡仍須命中而退入', async function() {
            await load(svgOpen() + `<path d="M${sx(160)} ${sy(219)} L${sx(560)} ${sy(219)}" stroke="#c00" stroke-width="0.6" fill="none"/></svg>` + popHtml())
            await expectAvoidsBottom('0.6px 細線', 218.6)
        })
        //面板大於 fixed 外層(寬高 0 之透明外層 + absolute 面板)之結構: 面板蓋住之圖形看不見, 面板內之宣告區屬浮層自身
        let overflowPanel = `<div id="wrap" style="position:fixed;z-index:20;left:${POP.l}px;top:${POP.t}px;width:0;height:0"><div id="panel" style="position:absolute;left:0;top:0;width:${POP.w}px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div style="padding:7px 8px">OR</div><div style="padding:7px 8px">AND</div><img id="ico" alt="" width="16" height="16" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="position:absolute;left:90px;top:40px"></div></div>`
        it('[J02] 浮層面板大於 fixed 外層: 面板正下方(被面板蓋住)之圖形不算內容', async function() {
            await load(svgOpen() + `<path d="M${sx(310)} ${sy(POP.t + 62)} L${sx(410)} ${sy(POP.t + 62)}" stroke="#c00" stroke-width="2" fill="none"/></svg>` + overflowPanel)
            let withLine = rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page))
            await load(svgOpen() + '</svg>' + overflowPanel)
            assert.deepStrictEqual(withLine, rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page)), '線被面板完全蓋住: 同無線')
        })
        it('[J03] graphicAreas 命中浮層自身(面板內之 img 超出 fixed 外層之範圍)不算', async function() {
            await load(overflowPanel)
            let base = rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page))
            assert.deepStrictEqual(rectOf(await itemsUnionBox('#wrap', { fit: true, graphicAreas: 'img' }).measure(page)), base)
        })
        it('[J05] 浮層自身之 svg(pointer-events:none, 位於面板盒之外, 例: 浮層旁之箭頭圖示)不算外部內容', async function() {
            let ov = (inner) => `<div id="wrap" style="position:fixed;z-index:20;left:${POP.l}px;top:${POP.t}px;width:${POP.w}px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div style="padding:7px 8px">OR</div><div style="padding:7px 8px">AND</div>${inner}</div>`
            await load(ov(''))
            let base = rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page))
            await load(ov(`<svg width="600" height="66" style="position:absolute;left:${POP.w + 2}px;top:0;pointer-events:none"><path d="M0 10 L600 10 M0 40 L600 40" stroke="#c00" stroke-width="2" fill="none"/></svg>`))
            assert.deepStrictEqual(rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page)), base)
        })
        it('[J04] 不繪製容器(defs/pattern/marker/symbol)內圖形之幾何不得被當內容(浮層貼近視窗左上角, 零矩形落入掃描範圍)', async function() {
            let ov = popHtml('left:20px;top:20px')
            let defsSvg = `<svg width="800" height="200" style="position:absolute;left:0;top:0"><defs><path d="M0 88.5 L800 88.5" stroke="#c00" stroke-width="200" fill="none"/><pattern id="pt" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="800" height="200" fill="#c00"/></pattern><marker id="mk"><circle cx="400" cy="88" r="40" fill="#c00"/></marker></defs></svg>`
            await load('<svg width="800" height="200" style="position:absolute;left:0;top:0"></svg>' + ov)
            let base = rectOf(await itemsUnionBox('#pop', { fit: true }).measure(page))
            await load(defsSvg + ov)
            assert.deepStrictEqual(rectOf(await itemsUnionBox('#pop', { fit: true }).measure(page)), base)
        })
    })

    describe('[L0x] 退入位置: 框線外緣退到內容前 1px(剛好不蓋), 放不下描邊時取間隙正中', function() {
        it('[L01] 四邊各自: 框線外緣距圖形內容恰 1px(浮層不因圖形而縮到只剩文字)', async function() {
            //下: 水平線占 [218, 219] → 外緣 217; 上: 線占 [147, 148] → 外緣 149; 右: 垂直線占 [422, 423] → 外緣 421; 左: 垂直線占 [297, 298] → 外緣 299
            await load(svgOpen() + lineAt(2) + '</svg>' + popHtml())
            assert.strictEqual((await measure()).b + 6, POP_BOTTOM + 2 - 1, '下')
            await load(svgOpen() + `<path d="M${sx(160)} ${sy(POP.t - 2.5)} L${sx(560)} ${sy(POP.t - 2.5)}" stroke="#c00" fill="none"/></svg>` + popHtml())
            assert.strictEqual((await measure()).t - 6, POP.t - 2 + 1, '上')
            await load(svgOpen() + `<path d="M${sx(POP.l + POP.w + 2.5)} ${sy(100)} L${sx(POP.l + POP.w + 2.5)} ${sy(300)}" stroke="#c00" fill="none"/></svg>` + popHtml())
            assert.strictEqual((await measure()).r + 6, POP.l + POP.w + 2 - 1, '右')
            await load(svgOpen() + `<path d="M${sx(POP.l - 2.5)} ${sy(100)} L${sx(POP.l - 2.5)} ${sy(300)}" stroke="#c00" fill="none"/></svg>` + popHtml())
            assert.strictEqual((await measure()).l - 6, POP.l - 2 + 1, '左')
        })
        it('[L02] 浮層內距小(2px)、內容貼著浮層邊: 放不下 5px 描邊, 取文字與內容間隙正中(同 HTML 鄰項規則)', async function() {
            let tinyPad = popHtml().replace('padding:7px 8px">AND', 'padding:7px 8px 2px">AND')
            await load(tinyPad)
            let ob = await page.evaluate(() => document.getElementById('pop').getBoundingClientRect().bottom) //浮層下緣(內距 2px 故文字下緣 = ob - 2)
            let ib = await innerBottom()
            assert.strictEqual(ob - ib, 2, '前提: 文字下緣距浮層下緣 2px')
            await load(svgOpen() + `<path d="M${sx(160)} ${sy(ob + 0.5)} L${sx(560)} ${sy(ob + 0.5)}" stroke="#c00" stroke-width="1" fill="none"/></svg>` + tinyPad)
            let r = await measure()
            //內容緊貼浮層下緣(占 [ob, ob+1])→ 首個命中列 y = ob → p = ob - 1; 外緣退到 p - 6 放不下(須 ≥ 文字下緣 - 1) → 取間隙正中 (文字下緣 + p) / 2 - 3.5
            let p = ob - 1
            assert.ok(Math.abs(r.b - ((ib + p) / 2 - 3.5)) < 0.01, `下緣 ${r.b} 應為間隙正中 ${(ib + p) / 2 - 3.5}`)
        })
        it('[L03] 浮層比文字寬: 右側垂直線緊貼浮層邊時, 右緣只退到內容前 1px, 不縮到文字範圍', async function() {
            await load(svgOpen() + `<path d="M${sx(POP.l + POP.w + 0.5)} ${sy(100)} L${sx(POP.l + POP.w + 0.5)} ${sy(300)}" stroke="#c00" fill="none"/></svg>` + popHtml())
            let r = await measure()
            assert.ok(r.r >= POP.l + POP.w - 8, `右緣 ${r.r} 應仍近浮層右緣 ${POP.l + POP.w}(未縮到文字範圍)`)
        })
    })

    describe('[K0x] 對抗審查補強(獨立審查者之反例轉為回歸測試)', function() {
        let grid = (inner, extra = '') => svgOpen(extra) + inner + '</svg>' + popHtml()
        it('[K01] 1px 細線落在像素格線上: 下方垂直線欄 301–304、右側水平線列 151–154 各自皆退入(取樣須逐 px)', async function() {
            for (let col of [301, 302, 303, 304]) {
                await load(grid(`<path d="M${sx(col + 0.5)} ${sy(POP_BOTTOM + 1)} L${sx(col + 0.5)} ${sy(POP_BOTTOM + 44)}" stroke="#c00" stroke-width="1" fill="none"/>`))
                let r = await measure()
                assert.ok(r.b + 6 <= POP_BOTTOM + 1, `下方垂直線欄 ${col}: 框線外緣 ${r.b + 6} 須 ≤ 內容上緣 ${POP_BOTTOM + 1}`)
            }
            for (let row of [151, 152, 153, 154]) {
                await load(grid(`<path d="M${sx(POP.l + POP.w + 1)} ${sy(row + 0.5)} L${sx(POP.l + POP.w + 50)} ${sy(row + 0.5)}" stroke="#c00" stroke-width="1" fill="none"/>`))
                let r = await measure()
                assert.ok(r.r + 6 <= POP.l + POP.w + 1, `右側水平線列 ${row}: 框線外緣 ${r.r + 6} 須 ≤ 內容左緣 ${POP.l + POP.w + 1}`)
            }
        })
        it('[K02] 框線帶之界: 下方線在列 221(帶內)退入; 在列 222、223(帶外)與無內容逐位元相同; 右側欄 425 退入、426 不動', async function() {
            await load(grid(lineAt(5)))
            assert.ok((await measure()).b < POP_BOTTOM, '列 221(間隙 5)退入')
            await expectSameAsBlank('列 222', grid(lineAt(6)))
            await expectSameAsBlank('列 223', grid(lineAt(7)))
            let vline = (col) => `<path d="M${sx(col + 0.5)} ${sy(100)} L${sx(col + 0.5)} ${sy(300)}" stroke="#c00" stroke-width="1" fill="none"/>`
            await load(grid(vline(POP.l + POP.w + 5)))
            assert.ok((await measure()).r < POP.l + POP.w, '欄 425 退入')
            await expectSameAsBlank('欄 426', grid(vline(POP.l + POP.w + 6)))
        })
        it('[K03] 與背後底色相同之填色形狀不算內容: 白色 path/polygon 背景、白 rect 占 40%、淺灰 #fafafa 背景(白底上差 ≤ 8/通道)', async function() {
            let full = `M0 0 L${SV.w} 0 L${SV.w} ${SV.h} L0 ${SV.h} Z`
            await expectSameAsBlank('白 path 背景', svgOpen().replace(/<rect[^>]*\/>/, '') + `<path d="${full}" fill="#fff"/></svg>` + popHtml())
            await expectSameAsBlank('白 polygon 背景', svgOpen().replace(/<rect[^>]*\/>/, '') + `<polygon points="0,0 ${SV.w},0 ${SV.w},${SV.h} 0,${SV.h}" fill="#fff"/></svg>` + popHtml())
            await expectSameAsBlank('白 rect 占 40%', svgOpen() + `<rect x="100" y="60" width="300" height="100" fill="#fff"/></svg>` + popHtml())
            await expectSameAsBlank('#fafafa path 背景', svgOpen().replace(/<rect[^>]*\/>/, '') + `<path d="${full}" fill="#fafafa"/></svg>` + popHtml())
        })
        it('[K04] 看不見之漸層/參考: fill=url(#不存在)、全透明色標之漸層(fill 與 stroke)不算內容; 有不透明色標者算', async function() {
            let grad = (op) => `<defs><linearGradient id="gg"><stop offset="0" stop-color="#c00" stop-opacity="${op}"/><stop offset="1" stop-color="#c00" stop-opacity="${op}"/></linearGradient></defs>`
            let bar = (paint) => `<rect x="${sx(160)}" y="${sy(POP_BOTTOM + 2)}" width="400" height="3" ${paint}/>`
            await expectSameAsBlank('fill 參考不存在', grid(bar('fill="url(#nope)"')))
            await expectSameAsBlank('fill 全透明漸層', grid(grad(0) + bar('fill="url(#gg)"')))
            await expectSameAsBlank('stroke 全透明漸層', grid(grad(0) + lineAt(2, 'stroke="url(#gg)"').replace('stroke="#c00" ', '')))
            await load(grid(grad(1) + bar('fill="url(#gg)"')))
            assert.ok((await measure()).b < POP_BOTTOM, '不透明漸層算內容')
        })
        it('[K05] 被祖先 overflow 裁掉之圖形不算: overflow:hidden 容器(200x100)內之大 svg 其線畫在容器外; overflow:auto 捲動容器內已捲出可視範圍者', async function() {
            let lineSvg = `<svg width="760" height="300" style="display:block"><rect width="760" height="300" fill="#fff"/><path d="M0 ${POP_BOTTOM + 2.5 - 60} L760 ${POP_BOTTOM + 2.5 - 60}" stroke="#c00" fill="none"/></svg>`
            await expectSameAsBlank('overflow:hidden', `<div style="position:absolute;left:20px;top:60px;width:200px;height:100px;overflow:hidden">${lineSvg}</div>` + popHtml())
            await expectSameAsBlank('overflow:auto 已捲出', `<div id="sc" style="position:absolute;left:20px;top:60px;width:760px;height:100px;overflow:auto">${lineSvg}</div><script>document.getElementById('sc').scrollTop=0</script>` + popHtml())
            await load(`<div style="position:absolute;left:20px;top:60px;width:760px;height:300px;overflow:hidden">${lineSvg}</div>` + popHtml())
            assert.ok((await measure()).b < POP_BOTTOM, '未被裁掉者(容器涵蓋)仍算內容')
        })
        it('[K06] overflow:visible 之 svg 根(內容畫在根框外)', async function() {
            await load(`<svg overflow="visible" width="800" height="100" style="position:absolute;left:0;top:60px"><path d="M160 ${POP_BOTTOM + 2.5 - 60} L560 ${POP_BOTTOM + 2.5 - 60}" stroke="#c00" fill="none"/></svg>` + popHtml())
            await expectAvoidsBottom('根框外之線', POP_BOTTOM + 2)
        })
        it('[K07] svg 文字被透明 HTML 覆蓋層蓋住(舊規則之命中測試只見覆蓋層): 仍算內容', async function() {
            await load(svgOpen() + `<text x="${sx(300)}" y="${sy(POP_BOTTOM + 14)}" font-size="14" fill="#c00">WWWWWWWWWW</text></svg><div style="position:absolute;left:100px;top:200px;width:600px;height:100px;z-index:5"></div>` + popHtml())
            let r = await measure()
            assert.ok(r.b < POP_BOTTOM, `文字在下方 2px 內: 退入(實得下緣 ${r.b})`)
        })
        it('[K08] canvas 看不見或被裁掉者不算: 祖先 opacity:0、祖先 overflow:hidden 之外', async function() {
            let draw = `var x=c.getContext('2d');x.strokeStyle='#c00';x.lineWidth=1;x.beginPath();x.moveTo(140,${POP_BOTTOM + 2.5 - 60});x.lineTo(540,${POP_BOTTOM + 2.5 - 60});x.stroke();`
            let cvs = `<canvas id="cv" width="760" height="300"></canvas><script>(function(){var c=document.getElementById('cv');${draw}})()</script>`
            await expectSameAsBlank('祖先 opacity 0', `<div style="position:absolute;left:20px;top:60px;opacity:0">${cvs}</div>` + popHtml())
            await expectSameAsBlank('祖先 overflow:hidden 外', `<div style="position:absolute;left:20px;top:60px;width:200px;height:100px;overflow:hidden">${cvs}</div>` + popHtml())
        })
        it('[K09] canvas 無資料之均勻底不算內容: 半透明灰底(.9)、半透明白底(.5)、不透明白底占 70% 加透明邊', async function() {
            let fill = (css, extra = '') => `<canvas id="cv" style="position:absolute;left:20px;top:60px" width="760" height="300"></canvas><script>(function(){var c=document.getElementById('cv'),x=c.getContext('2d');x.fillStyle='${css}';${extra || 'x.fillRect(0,0,760,300)'}})()</script>` + popHtml()
            await expectSameAsBlank('rgba(240,240,240,.9)', fill('rgba(240,240,240,0.9)'))
            await expectSameAsBlank('rgba(255,255,255,.5)', fill('rgba(255,255,255,0.5)'))
            await expectSameAsBlank('白底占 70% 加透明邊', fill('#fff', 'x.fillRect(114,45,532,210)'))
        })
        it('[K10] 量測不改動頁面: 未建立 context 之 canvas 量測後仍可取得 webgl context(不替來源呼叫 getContext("2d"))', async function() {
            await load(`<canvas id="cv" style="position:absolute;left:20px;top:60px" width="760" height="300"></canvas>` + popHtml())
            await measure()
            assert.ok(await page.evaluate(() => !!document.getElementById('cv').getContext('webgl')), '量測後仍能取得 webgl')
        })
        it('[K06b] 遠離浮層之大 svg 根(800x10)宣告 overflow:visible 而內容畫在根框外、落在浮層下方: 仍算內容(屬性或行內樣式宣告者)', async function() {
            await load(`<svg overflow="visible" width="800" height="10" style="position:absolute;left:0;top:10px"><path d="M140 ${POP_BOTTOM + 2.5 - 10} L540 ${POP_BOTTOM + 2.5 - 10}" stroke="#c00" fill="none"/></svg>` + popHtml())
            await expectAvoidsBottom('遠根框外之線', POP_BOTTOM + 2)
        })
        it('[K13] 撐滿圖表之有色底色矩形(例: 淡藍 #e8eef8)不算內容(顏色異於背後亦然, 同舊規則「大型容器之底色不算內容」)', async function() {
            await expectSameAsBlank('有色全幅底', `<svg style="position:absolute;left:20px;top:60px" width="${SV.w}" height="${SV.h}"><rect width="${SV.w}" height="${SV.h}" fill="#e8eef8"/></svg>` + popHtml())
        })
        it('[K11] 小於 480x120 之 svg/canvas(圖示、迷你圖)不另做圖形判定(舊規則已以整個元素框為內容): 浮層四周有 400 個小 svg 圖示時 graphics 開與關之 elementsFromPoint 次數相同', async function() {
            let icons = Array.from({ length: 400 }, (_, i) => `<svg width="16" height="16" style="position:absolute;left:${300 + (i % 25) * 4}px;top:${209 + Math.floor(i / 25) * 3}px"><path d="M0 8 L16 8" stroke="#c00" fill="none"/></svg>`).join('')
            await load(icons + popHtml())
            assert.strictEqual(await countEfp(true), await countEfp(false))
        })
        it('[K14] 透明面板(無底色, 無法以「有底色之層蓋住」判定)大於 fixed 外層: 面板內距內之圖形屬浮層自身蓋住之點, 不算外部內容', async function() {
            let panel = '<div id="wrap" style="position:fixed;z-index:20;left:300px;top:150px;width:0;height:0"><div id="panel" style="position:absolute;left:0;top:0;width:120px;padding:8px;font:14px sans-serif;box-sizing:border-box"><div>OR</div><div style="margin-top:14px">AND</div></div></div>'
            let withLine = (y) => svgOpen() + `<path d="M310 ${sy(y)} L410 ${sy(y)}" stroke="#c00" fill="none"/></svg>` + panel
            await load(svgOpen() + '</svg>' + panel)
            let base = rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page))
            await load(withLine(216.5))
            assert.deepStrictEqual(rectOf(await itemsUnionBox('#wrap', { fit: true }).measure(page)), base, '線在面板下內距內(面板底 218): 同無線')
        })
        it('[K12] 含翻轉/旋轉之 CSS 變換的 canvas 無從自動判定(座標對應不成立): 預設同無內容, graphicAreas 宣告後退入', async function() {
            let draw = `var x=c.getContext('2d');x.strokeStyle='#c00';x.beginPath();x.moveTo(140,${300 - (POP_BOTTOM + 2.5 - 60)});x.lineTo(540,${300 - (POP_BOTTOM + 2.5 - 60)});x.stroke();`
            let html = `<canvas id="cv" style="position:absolute;left:20px;top:60px;transform:scaleY(-1)" width="760" height="300"></canvas><script>(function(){var c=document.getElementById('cv');${draw}})()</script>` + popHtml()
            await expectSameAsBlank('scaleY(-1) 預設', html)
            await load(html)
            assert.ok((await measure({ graphicAreas: '#cv' })).b < POP_BOTTOM)
        })
    })

    describe('[N0x] 外部審查補強(外審反例轉為回歸測試: 夾制退化、離屏畫布、遮蓋、裁切、取樣界、底色、文字樣式、現代色彩、canvas 內容盒、粗線、遠端面板)', function() {
        let canvasEl = (id, style = '', w = 760, h = 300) => `<canvas id="${id}" style="position:absolute;left:20px;top:60px;${style}" width="${w}" height="${h}"></canvas>`
        //於 canvas(位圖座標) (x, y) 畫 w x h 之紅色矩形
        let drawRed = (id, x, y, w, h) => page.evaluate(([i, a, b, c, d]) => {
            let cx = document.getElementById(i).getContext('2d')
            cx.fillStyle = '#c00'
            cx.fillRect(a, b, c, d)
        }, [id, x, y, w, h])
        let vline = (col, y1 = 100, y2 = 300) => `<path d="M${sx(col + 0.5)} ${sy(y1)} L${sx(col + 0.5)} ${sy(y2)}" stroke="#c00" stroke-width="1" fill="none"/>`
        let hline = (row, x1 = 160, x2 = 560) => `<path d="M${sx(x1)} ${sy(row + 0.5)} L${sx(x2)} ${sy(row + 0.5)}" stroke="#c00" stroke-width="1" fill="none"/>`
        let gridHtml = (inner, extra = '') => svgOpen(extra) + inner + '</svg>' + popHtml()

        it('[N01] 圖形夾到沒有尺寸(窄浮層, 左側線 + 右側緊鄰晶片): 只撤銷圖形之夾制, HTML 規則之避讓保留(與 graphics:false 相同)', async function() {
            for (let width of [4, 5, 6]) {
                let html = svgOpen() + vline(298) + '</svg>' + `<div style="position:absolute;left:${301 + width}px;top:150px;width:20px;height:20px;background:#ccc"></div><div id="pop" style="position:fixed;z-index:20;left:300px;top:150px;width:${width}px;height:20px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>`
                await load(html)
                let on = await measure()
                assert.deepStrictEqual(on, await measure({ graphics: false }), `浮層寬 ${width}px`)
            }
        })

        it('[N02] 跨域污染 canvas 在前、乾淨 canvas(含線)在後: 乾淨者仍判定(各 canvas 自有離屏畫布, 不共用)', async function() {
            await page.route('http://other.invalid/img.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#c00"/></svg>' }))
            await load(canvasEl('tn') + canvasEl('cv') + popHtml())
            await page.evaluate(async () => {
                let im = new Image()
                im.src = 'http://other.invalid/img.svg'
                await im.decode()
                document.getElementById('tn').getContext('2d').drawImage(im, 0, 0)
            })
            await drawRed('cv', 330, POP_BOTTOM + 2 - 60, 200, 1) //線自視窗 x=350 起: 其所在 64px 分塊在前一張污染 canvas 之讀取失敗之後才首次讀取
            let taint = await page.evaluate(() => {
                try {
                    document.getElementById('tn').getContext('2d').getImageData(0, 0, 1, 1)
                    return ''
                }
                catch (e) {
                    return e.name
                }
            })
            assert.strictEqual(taint, 'SecurityError', '前提: 前一張 canvas 確已被跨域圖污染')
            await expectAvoidsBottom('污染在前', POP_BOTTOM + 2)
            await page.unroute('http://other.invalid/img.svg')
        })

        it('[N03] 遮蓋雙向: 透明 canvas / 完全透明(opacity:0)有底色層蓋在線上 → 線仍算; 不透明 svg 遮片(他根、同根居後)蓋住 → 不算', async function() {
            await load(gridHtml(hline(POP_BOTTOM + 2)).replace('<div id="pop"', canvasEl('ov', 'z-index:5') + '<div id="pop"'))
            await expectAvoidsBottom('透明 canvas 蓋住', POP_BOTTOM + 2)
            await load(gridHtml(hline(POP_BOTTOM + 2)) + `<div style="position:absolute;left:140px;top:210px;width:440px;height:30px;background:#fff;opacity:0"></div>`)
            await expectAvoidsBottom('opacity:0 之白底層蓋住', POP_BOTTOM + 2)
            await expectSameAsBlank('他根不透明 svg 遮片', gridHtml(hline(POP_BOTTOM + 2)) + `<svg style="position:absolute;left:20px;top:60px;z-index:5" width="760" height="300"><rect width="760" height="300" fill="#fff"/></svg>`)
            await expectSameAsBlank('同根居後之不透明遮片', svgOpen() + hline(POP_BOTTOM + 2) + `<rect width="${SV.w}" height="${SV.h}" fill="#fff"/></svg>` + popHtml())
        })

        it('[N04] 裁切確認以實際命中點為準: canvas 被 clip-path 裁掉者不算; 0.6px 細線在 clip-path 內(命中點偏離像素中心)仍算; graphicAreas 被裁掉者不算', async function() {
            await load(canvasEl('cv', 'clip-path:inset(0 0 200px 0)') + popHtml())
            await drawRed('cv', 140, POP_BOTTOM + 2 - 60, 400, 1)
            assert.deepStrictEqual(await measure(), await blank(), 'canvas 有線但被 clip-path 裁掉(線在可視範圍外): 同無內容')
            await load(svgOpen() + `<clipPath id="cp"><rect x="0" y="0" width="${SV.w}" height="${SV.h}"/></clipPath><g clip-path="url(#cp)"><path d="M${sx(160)} ${sy(219)} L${sx(560)} ${sy(219)}" stroke="#c00" stroke-width="0.6" fill="none"/></g></svg>` + popHtml())
            await expectAvoidsBottom('clip-path 內之 0.6px 細線', 218.6)
            await expectSameAsBlank('graphicAreas 被 clip-path 裁掉', `<div id="big" style="position:absolute;left:20px;top:60px;width:760px;height:300px;clip-path:inset(0 0 240px 0)"></div>` + popHtml(), { graphicAreas: '#big' })
        })

        it('[N05] 沿邊取樣含首/末像素欄與小數邊: 貼框矩形左緣(欄 300)、右緣(欄 419)之下方垂直線; 浮層上緣 150.5 / 左緣 300.5 時帶端點所在之列/欄', async function() {
            for (let col of [300, 419]) {
                await load(gridHtml(vline(col, POP_BOTTOM + 1, 280)))
                await expectAvoidsBottom(`欄 ${col}`, POP_BOTTOM + 1)
            }
            await load(svgOpen() + hline(144) + '</svg>' + popHtml('top:150.5px'))
            let rt = await measure()
            assert.ok(rt.t - 6 >= 145, `上緣 150.5: 帶 [144.5, 149.5] 與列 144 相交, 框線外緣 ${rt.t - 6} 須 ≥ 線下緣 145`)
            await load(svgOpen() + vline(294) + '</svg>' + popHtml('left:300.5px'))
            let rl = await measure()
            assert.ok(rl.l - 6 >= 295, `左緣 300.5: 帶 [294.5, 299.5] 與欄 294 相交, 框線外緣 ${rl.l - 6} 須 ≥ 線右緣 295`)
        })

        it('[N06] 四向對稱: 距矩形邊 g=0(緊鄰守距列)、1、2、5(帶內)皆退入, g=6、8、12、30(帶外)與無內容逐位元相同', async function() {
            let sides = {
                top: (g) => hline(POP.t - 1 - g),
                left: (g) => vline(POP.l - 1 - g),
                right: (g) => vline(POP.l + POP.w + g),
            }
            for (let [side, mk] of Object.entries(sides)) {
                for (let g of [0, 1, 2, 5]) {
                    await load(gridHtml(mk(g)))
                    let r = await measure()
                    if (side === 'top') {
                        assert.ok(r.t - 6 >= POP.t - g, `${side} g=${g}: 框線外緣 ${r.t - 6} 須 ≥ 內容下緣 ${POP.t - g}`)
                    }
                    else if (side === 'left') {
                        assert.ok(r.l - 6 >= POP.l - g, `${side} g=${g}: 框線外緣 ${r.l - 6} 須 ≥ 內容右緣 ${POP.l - g}`)
                    }
                    else {
                        assert.ok(r.r + 6 <= POP.l + POP.w + g, `${side} g=${g}: 框線外緣 ${r.r + 6} 須 ≤ 內容左緣 ${POP.l + POP.w + g}`)
                    }
                }
                for (let g of [6, 8, 12, 30]) {
                    await expectSameAsBlank(`${side} g=${g}`, gridHtml(mk(g)))
                }
            }
        })

        it('[N07] 框矩形內(inkPad 區)之線不介入: 文字目標(浮層末項, 無內距; 框矩形 = 文字 ± 4px)下方 1–3px 之線 → 與 graphics:false 相同; 不使框線內緣越過文字', async function() {
            let tight = popHtml().replace('padding:7px 8px">AND', 'padding:7px 8px 0">AND')
            await load(tight)
            let ob = await page.evaluate(() => document.getElementById('pop').getBoundingClientRect().bottom)
            for (let g of [1, 2, 3]) {
                await load(svgOpen() + hline(ob + g, 312, 336) + '</svg>' + tight) //線只在目標矩形寬度內(不橫貫左右框線帶)
                assert.deepStrictEqual(await measure({}, '#pop > div:last-child'), await measure({ graphics: false }, '#pop > div:last-child'), `g=${g}`)
            }
        })

        it('[N07b] 四向框矩形內(inkPad 區)之線不介入: 文字目標(浮層無內距、寬貼合文字)上/下/左/右各距文字 1–3px 之短線 → 與 graphics:false 相同(四向起點一致, 不單向使框線內緣越過文字)', async function() {
            let pop = `<div id="pop" style="position:fixed;z-index:20;left:300px;top:150px;width:fit-content;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div id="t">OR AND</div></div>`
            await load(svgOpen() + '</svg>' + pop)
            let tr = await page.evaluate(() => {
                let rg = document.createRange()
                rg.selectNodeContents(document.getElementById('t'))
                let r = rg.getBoundingClientRect()
                return { l: r.left, t: r.top, r: r.right, b: r.bottom }
            })
            let sides = {
                top: (g) => hline(Math.floor(tr.t) - g, tr.l + 4, tr.r - 4),
                bottom: (g) => hline(Math.ceil(tr.b) + g - 1, tr.l + 4, tr.r - 4),
                left: (g) => vline(Math.floor(tr.l) - g, tr.t + 3, tr.b - 3),
                right: (g) => vline(Math.floor(tr.r) + g, tr.t + 3, tr.b - 3),
            }
            for (let [side, mk] of Object.entries(sides)) {
                for (let g of [1, 2, 3]) {
                    await load(svgOpen() + mk(g) + '</svg>' + pop)
                    assert.deepStrictEqual(await measure({}, '#t'), await measure({ graphics: false }, '#t'), `${side} g=${g}`)
                }
            }
        })

        it('[N08] 黑底圖表(最上層撐滿之不透明 rect 為圖表底色): 白色線/條算內容; 與黑底同色者不算', async function() {
            let black = `<svg id="chart" style="position:absolute;left:20px;top:60px" width="${SV.w}" height="${SV.h}"><rect width="${SV.w}" height="${SV.h}" fill="#000"/>`
            let bar = (fill) => `<rect x="${sx(160)}" y="${sy(POP_BOTTOM + 2)}" width="400" height="1" fill="${fill}"/>`
            await load(black + bar('#fff') + '</svg>' + popHtml())
            await expectAvoidsBottom('黑底白條', POP_BOTTOM + 2)
            await load(black + hline(POP_BOTTOM + 2).replace('#c00', '#fff') + '</svg>' + popHtml())
            await expectAvoidsBottom('黑底白線', POP_BOTTOM + 2)
            await expectSameAsBlank('黑底黑條', black + bar('#000') + '</svg>' + popHtml())
        })

        it('[N09] svg 文字逐文字節點判可見(tspan 自有 fill/opacity): 外層 fill:none 但 tspan 有色 → 算; 外層有色但 tspan opacity:0 或 fill:none → 不算; 純描邊文字 → 算', async function() {
            let text = (attrs, inner) => `<text x="${sx(300)}" y="${sy(POP_BOTTOM + 14)}" font-size="12" pointer-events="none" ${attrs}>${inner}</text>`
            let w = 'WWWWWWWWWWWWWWWWWWWW'
            for (let [name, shape] of [
                ['外層 none + tspan 有色', text('fill="none"', `<tspan fill="#c00">${w}</tspan>`)],
                ['純描邊', text('fill="none" stroke="#c00" stroke-width="1"', w)],
            ]) {
                await load(svgOpen() + shape + '</svg>' + popHtml())
                assert.ok((await measure()).b < POP_BOTTOM, `${name}: 須退入`)
            }
            await expectSameAsBlank('tspan opacity 0', svgOpen() + text('fill="#c00"', `<tspan opacity="0">${w}</tspan>`) + '</svg>' + popHtml())
            await expectSameAsBlank('tspan fill none', svgOpen() + text('fill="#c00"', `<tspan fill="none">${w}</tspan>`) + '</svg>' + popHtml())
        })

        it('[N10] 現代色彩空間: 全透明/低 alpha 之 color(display-p3)、oklch、lab 線與條不算; 不透明 P3 線算; color(srgb 1 1 1) 白條在白底上不算', async function() {
            let styled = (css) => lineAt(2, `style="${css}"`)
            for (let css of ['stroke:color(display-p3 1 0 0 / 0)', 'stroke:oklch(0.6 0.2 30 / 0)', 'stroke:lab(50 40 30 / 0.05)']) {
                await expectSameAsBlank(css, svgOpen() + styled(css) + '</svg>' + popHtml())
            }
            await load(svgOpen() + styled('stroke:color(display-p3 1 0 0)') + '</svg>' + popHtml())
            await expectAvoidsBottom('不透明 P3 線', POP_BOTTOM + 2)
            let bar = (fill) => `<rect x="${sx(160)}" y="${sy(POP_BOTTOM + 2)}" width="400" height="1" fill="${fill}"/>`
            await expectSameAsBlank('color(srgb 1 1 1) 白條', svgOpen() + bar('color(srgb 1 1 1)') + '</svg>' + popHtml())
            await expectSameAsBlank('fill color(display-p3 1 0 0 / 0)', svgOpen() + bar('color(display-p3 1 0 0 / 0)') + '</svg>' + popHtml())
        })

        it('[N11] canvas 位圖只畫在內容盒: 含 border 10 + padding 20 之 canvas, 與 object-fit:contain 之 canvas, 其線之視窗位置須換算而退入', async function() {
            await load(canvasEl('cv', 'border:10px solid transparent;padding:20px') + popHtml())
            await drawRed('cv', 140, POP_BOTTOM + 2 - 90, 400, 1) //內容盒原點 (50, 90)
            await expectAvoidsBottom('border + padding', POP_BOTTOM + 2)
            await load(canvasEl('cv', 'width:760px;height:300px;object-fit:contain', 300, 300) + popHtml()) //位圖 300x300 置中於 760x300 → 視窗 x 250–550
            await drawRed('cv', 0, POP_BOTTOM + 2 - 60, 300, 1)
            await expectAvoidsBottom('object-fit:contain', POP_BOTTOM + 2)
        })

        it('[N12] 粗描邊: 484px 寬之線(中心在視窗外 y=460, 距浮層下緣 244px, 幾何外接框遠離候選範圍, 但描邊涵蓋至浮層下方 2px 起)仍算內容', async function() {
            await load(svgOpen('overflow="visible"') + `<path d="M${sx(160)} ${sy(460)} L${sx(560)} ${sy(460)}" stroke="#c00" stroke-width="484" fill="none"/></svg>` + popHtml())
            await expectAvoidsBottom('484px 粗線', POP_BOTTOM + 2)
        })

        it('[N13] 面板遠大於 fixed 外層(0x0 外層 + absolute 面板, 面板下緣離外層 > 64px): 面板下方線仍算內容(候選範圍含框矩形)', async function() {
            for (let h of [0, 40, 120]) {
                await load(`<svg id="chart" style="position:absolute;left:0;top:0" width="800" height="420"><rect width="800" height="420" fill="#fff"/></svg><div id="wrap" style="position:fixed;z-index:20;left:300px;top:100px;width:0;height:0"><div id="panel" style="position:absolute;left:0;top:0;width:120px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif"><div style="padding:7px 8px">OR</div><div style="height:${h}px"></div><div id="item" style="padding:7px 8px">AND</div></div></div>`)
                let pb = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().bottom)
                await page.evaluate((y) => {
                    let p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
                    p.setAttribute('d', `M100 ${y} L700 ${y}`)
                    p.setAttribute('stroke', '#c00')
                    p.setAttribute('fill', 'none')
                    document.getElementById('chart').appendChild(p)
                }, pb + 2.5)
                let on = rectOf(await itemsUnionBox('#item', { fit: true }).measure(page))
                let off = rectOf(await itemsUnionBox('#item', { fit: true, graphics: false }).measure(page))
                assert.ok(on.b < off.b, `面板高 +${h}: 下緣須退入(開 ${on.b} vs 關 ${off.b})`)
            }
        })

        it('[N14] 遠離浮層之大 svg 根(800x10)以樣式表規則(class)宣告 overflow:visible 而內容畫在根框外: 仍算內容(計算樣式)', async function() {
            await load(`<style>.ov{overflow:visible}</style><svg class="ov" width="800" height="10" style="position:absolute;left:0;top:395px"><path d="M140 ${POP_BOTTOM + 2.5 - 395} L540 ${POP_BOTTOM + 2.5 - 395}" stroke="#c00" fill="none"/></svg>` + popHtml())
            await expectAvoidsBottom('class 宣告 overflow:visible', POP_BOTTOM + 2)
        })

        it('[N15] 撐滿圖表之底色矩形(任何填色)不算內容: 半透明有色(alpha .2)、不透明漸層填色之全幅 rect 同無內容(不依賴「不透明且同圖表底色」之補充判定)', async function() {
            let full = (paint) => `<rect width="${SV.w}" height="${SV.h}" ${paint}/>`
            await expectSameAsBlank('半透明有色全幅 rect', svgOpen().replace(/<rect[^>]*\/>/, '') + full('fill="rgba(0,0,200,0.2)"') + '</svg>' + popHtml())
            await expectSameAsBlank('漸層填色全幅 rect', svgOpen().replace(/<rect[^>]*\/>/, '') + `<defs><linearGradient id="bg"><stop offset="0" stop-color="#eef"/><stop offset="1" stop-color="#cde"/></linearGradient></defs>` + full('fill="url(#bg)"') + '</svg>' + popHtml())
        })
    })

    describe('[M0x] 差分: 無大型圖形之頁面, graphics 開關不影響量框(只增不減之不變式)', function() {
        it('[M01] 隨機 80 頁(固定種子;HTML 文字、晶片、大色塊、小 svg 圖示、小 canvas、遮罩、透明攔截層)× 浮層與其內項目: graphics:true 與 graphics:false 之量框逐位元相同', async function() {
            let seed = 20261020
            let rnd = () => {
                seed = (seed * 1664525 + 1013904223) % 4294967296
                return seed / 4294967296
            }
            let ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
            let pick = (arr) => arr[ri(0, arr.length - 1)]
            let word = () => pick(['Alpha', 'OR', 'AND', '每日', 'English', 'P2', 'x'])
            let engaged = 0
            for (let i = 0; i < 80; i++) {
                let parts = []
                for (let k = ri(0, 8); k > 0; k--) {
                    let l = ri(0, 700)
                    let t = ri(0, 380)
                    let kind = pick(['text', 'chip', 'chip', 'block', 'icon', 'mini', 'line'])
                    if (kind === 'text') {
                        parts.push(`<div style="position:absolute;left:${l}px;top:${t}px;font:14px sans-serif">${word()}</div>`)
                    }
                    else if (kind === 'chip') {
                        parts.push(`<div style="position:absolute;left:${l}px;top:${t}px;width:${ri(30, 120)}px;height:${ri(16, 40)}px;background:#eee;border:1px solid #bbb;box-sizing:border-box;font:12px sans-serif">${word()}</div>`)
                    }
                    else if (kind === 'block') {
                        parts.push(`<div style="position:absolute;left:${l}px;top:${t}px;width:${ri(500, 780)}px;height:${ri(20, 130)}px;background:#eef"></div>`)
                    }
                    else if (kind === 'icon') {
                        parts.push(`<svg width="16" height="16" style="position:absolute;left:${l}px;top:${t}px"><path d="M0 8 L16 8" stroke="#c00" fill="none"/></svg>`)
                    }
                    else if (kind === 'mini') {
                        parts.push(`<canvas width="100" height="30" style="position:absolute;left:${l}px;top:${t}px"></canvas>`)
                    }
                    else {
                        parts.push(`<div style="position:absolute;left:${l}px;top:${t}px;width:${ri(100, 400)}px;border-top:1px solid #999"></div>`)
                    }
                }
                let layer = pick(['', '', 'mask', 'clear'])
                if (layer) {
                    parts.push(`<div style="position:fixed;z-index:10;left:0;top:0;width:100vw;height:100vh;${layer === 'mask' ? 'background:rgba(0,0,0,.3)' : ''}"></div>`)
                }
                let items = Array.from({ length: ri(1, 4) }, () => `<div tabindex="0" style="padding:${ri(2, 9)}px ${ri(2, 9)}px">${word()}</div>`).join('')
                parts.push(`<div id="pop" style="position:fixed;z-index:20;left:${ri(0, 600)}px;top:${ri(0, 300)}px;width:${ri(60, 200)}px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font:14px sans-serif">${items}</div>`)
                await load(parts.join(''))
                for (let sel of ['#pop', '#pop div[tabindex]']) {
                    let on = await measure({ graphics: true }, sel)
                    let off = await measure({ graphics: false }, sel)
                    assert.deepStrictEqual(on, off, `頁 ${i} ${sel}`)
                    let own = await page.locator(sel).first().boundingBox()
                    if (Math.abs(own.y + own.height - on.b) > 0.01 || Math.abs(own.x + own.width - on.r) > 0.01 || Math.abs(own.x - on.l) > 0.01 || Math.abs(own.y - on.t) > 0.01) {
                        engaged++
                    }
                }
            }
            assert.ok(engaged >= 20, `前提: 舊規則於隨機頁面確有介入(量框異於元素本身)之次數 ${engaged} 須 ≥ 20, 否則差分空轉`)
        })
    })

    describe('[I0x] 取樣成本與除錯', function() {
        it('[I01] 頁面無任何 svg/canvas/宣告區時, graphics 開與關之 elementsFromPoint 呼叫次數相同(不增加取樣成本)', async function() {
            await load(popHtml())
            assert.strictEqual(await countEfp(true), await countEfp(false))
        })
        it('[I02] E2E_BOX_DEBUG: dbg 列出各邊命中之圖形(graphic 欄: 邊 → 描述@座標)', async function() {
            await load(svgOpen() + lineAt(2) + '</svg>' + popHtml())
            let logs = []
            let orig = console.log
            console.log = (...a) => {
                logs.push(a.join(' '))
            }
            process.env.E2E_BOX_DEBUG = '1'
            try {
                await itemsUnionBox('#pop', { fit: true }).measure(page)
            }
            finally {
                delete process.env.E2E_BOX_DEBUG
                console.log = orig
            }
            let line = logs.find((s) => s.includes('[itemsUnionBox debug]')) || ''
            assert.ok(/"graphic":\{"bottom":"svg:path[^"]*@\d+,\d+"\}/.test(line), `dbg 應含 graphic.bottom(實得 ${line.slice(0, 300)})`)
        })
    })
})
