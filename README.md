# w-package-tools-e2e
Shared tools for Playwright e2e tests and pixel-baseline screenshots.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-package-tools-e2e.svg?style=flat)](https://npmjs.org/package/w-package-tools-e2e) 
[![license](https://img.shields.io/npm/l/w-package-tools-e2e.svg?style=flat)](https://npmjs.org/package/w-package-tools-e2e) 
[![npm download](https://img.shields.io/npm/dt/w-package-tools-e2e.svg)](https://npmjs.org/package/w-package-tools-e2e) 
[![npmdownload](https://img.shields.io/npm/dm/w-package-tools-e2e.svg)](https://npmjs.org/package/w-package-tools-e2e) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-package-tools-e2e.svg)](https://www.jsdelivr.com/package/npm/w-package-tools-e2e)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-package-tools-e2e/global.html#addVersion).

## Installation

### Using npm(ES6 module):
```alias

npm i w-package-tools-e2e

//launchChromium: 啟動Playwright之Chromium, 所需版本之瀏覽器不存在時先自動下載(不依賴安裝腳本)
import launchChromium from 'w-package-tools-e2e/src/launchChromium.mjs'
let browser = await launchChromium({ headless: true })

//其餘模組同樣以深層引用使用: w-package-tools-e2e/src/<模組名>.mjs, 模組清單見下
import launchBrowser from 'w-package-tools-e2e/src/launchBrowser.mjs'
import captureStableWithBox from 'w-package-tools-e2e/src/captureStableWithBox.mjs'
import assertBaselineMatch from 'w-package-tools-e2e/src/assertBaselineMatch.mjs'

//或經共用入口 WPackageToolsE2e 取用全部模組(會一併載入全部模組與其依賴)
import wpte from 'w-package-tools-e2e/src/WPackageToolsE2e.mjs'
let browser2 = await wpte.launchBrowser()

```

## 概述

本套件提供 e2e 測試與標準圖（pixel baseline）之共用設施：確定性截圖、截圖後合成之紅框、遮罩與貼圖覆蓋、反鋸齒感知之像素比對、產製端與比對端共用之單一案例管線、截圖前篩選與孤兒檢查、服務生命週期與行程原語、盤點 CLI。內容自 w-web-sso、w-web-perm、w-web-api、w-web-task 四專案之 e2e 基礎設施抽提（2026-09-27～28 暫存於 w-web-sso 之 `srcPack/`，四專案經各自 `test/tools/e2eLib.mjs` 橋接實跑驗證），2026-09-29 移入本套件。規格基準為全域技能 role-coder-for-test-e2e（SKILL.md §3 契約 C1–C15、§7、§8、§9 與 references/e2e-setup-contract.md）。

- 每檔一個 default export，繁中 JSDoc 附 `@example`；以深層引用使用（`w-package-tools-e2e/src/<名稱>.mjs`；本套件無 `main`／`exports`）。另有具名匯出：`composeBox.mjs` 之 `BOX_PAD`／`BOX_STROKE`、`inkRect.mjs` 之 `INK_PAD`。
- 共用入口 `src/WPackageToolsE2e.mjs`：匯入 `src/` 內其他全部模組，default export 為含全部模組與上述三個常數之物件（依 §1 之分組排列）；引用它會一併載入全部模組與其依賴（playwright、sharp 等），只用少數函數者宜深層引用。`tools/` 之 CLI 為可執行腳本，不經入口匯入。
- 依賴只用本套件已列者：playwright（經 `launchChromium`）、pixelmatch、pngjs、sharp、json5，以及 wsemi（2026-10-30 起，僅 `listenerPids`／`killPortListeners` 深層引用其 `wsemi/src/execProcessPortPidsSync.mjs` 查埠之監聽者，不經 wsemi 主入口）；不引入 lodash。
- 外部副作用（exec、spawn、fetch、process、globalThis、寫檔函數或落點）皆可由 opt 注入，供單元測試。
- 各函數之預設值即 w-web-sso 現行組態所用者；其他專案之差異以選項重現。

## 1. 模組清單

狀態欄照錄抽提期（2026-09-27～28）之驗證紀錄：**sso 實跑**＝已由 w-web-sso 之 e2e／api 全套經此函數實跑；**瀏覽器**＝以 `page.setContent` 之無伺服器測試驗證（含與當時實作凍結複本逐位元比對）；**單元**＝單元測試（注入假物件）。

### 1.1 截圖與影像

| 檔 | 用途 | 狀態 |
|---|---|---|
| `launchChromium(opt)` | 啟動 Playwright 之 Chromium；所需版本之瀏覽器不存在時先以 Playwright 自身之 CLI 下載（不依賴安裝腳本），Linux 缺系統相依時先 install-deps；指定 `channel`（如 `'chrome'`）或 `executablePath` 時不自動安裝 | 單元（`launchChromiumCore`）、實跑（全新環境下載、已安裝不重下、多程序並發只下載一次） |
| `chromiumLaunchArgs` | 確定性渲染六旗標（凍結陣列，C1） | sso 實跑 |
| `launchBrowser(opt)` | 唯一 launch 出口：`launchChromium({ headless:true, ...opt, args:[...六旗標, ...opt.args] })` | sso 實跑 |
| `captureStable(page, opt)` | 標準圖截圖唯一入口（C6），序列見 §2.3 | sso 實跑、瀏覽器 |
| `captureStableWithBox(page, target, opt)` | 全頁穩定截圖＋紅框（C7）＋遮罩（C8）；**目標找不到／尺寸為 0／夾邊後過小即拋錯**（2026-09-28；原為靜默回無框圖），`allowNoBox:true` 才容許無框；target 另接受**量測型目標** `{scroll, measure(page), label, probe}`（捲入與等待之後才量）；**被蓋住檢查**：選擇器／Locator 目標（與量測型目標之 `probe`）中心點之最上層元素若為無關元素（彈窗遮罩等）即拋錯（SKILL §7.3-4），`coverCheck:'warn'\|'off'` 或環境變數 `E2E_COVER_CHECK` 調整；**捲入**：目標比其可視區（視窗與各層捲動容器之交集）大且已部分入鏡時，捲入只會改變版面（使用者不會捲動＝假畫面），`scrollTall:false` 不捲、框可見部分，預設沿用捲入並印 `[box-scroll]` 告警；逐案判斷使用者此刻會不會捲動：切分頁後之整個檢視面板不會 → `itemsUnionBox(loc, { scroll: null })` 或 `scrollTall:false`（w-web-api display E2E-007 殷鑑），送出請求後出現在下方之回應卡會 → 照常捲入（w-web-api apitest E2E-001-3） | sso 實跑、瀏覽器 |
| `itemsUnionBox(itemSel, {within, scroll, fit, inkPad, graphics, graphicAreas})` | 量測型目標：可見項目之聯集夾在範圍容器內（清單／樹／選單／時間軸／工具列項目；SKILL §7.2 清單列、§7.3-2 不框整區空白）；`itemSel` 可為選擇器、其陣列或 **Locator**（同一頁內量測函式；Locator 者輸出 `probe` 供被蓋住檢查）；`fit:true` 依**元素自身有無可見邊界**決定量法：有（底色異於背後、邊框、陰影、背景圖、替換元素）量元素本身，無（透明容器、整行文字、開關與其標籤、勾選列、無內距之欄位列）改量**可見內容**（有邊界之子元素框與文字行框之聯集，透明內距不計）並**一律外擴 `inkPad`（預設 `INK_PAD`=4）**——勾選框、開關軌道、圖示與文字同留白，免紅框壓字；可見內容恰為單一有邊界元素（透明外層包著之面板、按鈕）時視同框該元素、不外擴；`fit` 另使**框線不蓋框外內容**：框線中心置於與相鄰項目（自元素往上至多 4 層之緊鄰兄弟，四向各取最近一層）**可見範圍**之間隙正中——可見範圍為有邊界者之元素框、無邊界者之子元素與文字聯集（不取含透明內距之元素框，免把框線拉回目標自身文字）；空白間隔不算鄰項；`position:fixed` 浮層（下拉清單、浮出面板；全畫面者除外）之外的頁面內容以命中測試找（文字、晶片／按鈕／觸發區級之有邊界元件、圖示與表單元件；大容器底色、整張圖表、遮罩後之背景不算），框線置於「目標內容」與「浮層外最近內容」之間隙正中——目標涵蓋整個浮層時（浮層本身、其透明外層包裝或撐滿之面板）以面板內容計（撐滿面板寬或高之標頭列、清單底色屬結構，改看其內文字與元件）、框線可退入面板內距，四周無內容照常外擴；**圖形內容**（Gitea issue #6）：浮層疊在大型 svg/canvas 圖表上時，框線不蓋其下之資料線——`graphics`（預設 `true`）自動判定 svg 圖形（幾何判定，不靠命中測試）與可讀 2d canvas 之像素為框外內容，`graphicAreas`（選擇器字串或陣列）宣告 img/video/WebGL/跨域污染 canvas/地圖等無從自動判定者整區視為內容；規則、受影響者、逃生口與已知限制見 §2.7；環境變數 `E2E_BOX_DEBUG` 有值時印出量測細節（含各邊命中之圖形） | 瀏覽器（2026-10-20 加 graphics、graphicAreas；2026-09-28 新增；同日加 Locator、可見邊界判準（邊框須 ≥ 3 邊）、inkPad、相鄰與浮層夾邊、鄰項改以可見範圍計、浮層改以命中測試取間隙正中、可見內容一律外擴、透明外層之面板） |
| `inkRect(rect, { pad, neighbors })`、`INK_PAD` | 無 DOM 之緊貼墨跡矩形（canvas 圖例列、翻頁箭頭、圖例項等圖表程式庫回報之視窗矩形）外擴 `INK_PAD`（4），交 `captureStableWithBox` 作矩形目標；`neighbors` 為鄰項之可見矩形，框線不越過與鄰項間隙之正中；與 `itemsUnionBox` 之 `fit` 共用同一常數。**目標與鄰項皆須為實際墨跡**（先經 `canvasInkRects`），鄰項須含畫面上有墨跡之全部項目（含被捲動窗裁掉一部分者） | 單元（2026-09-28 新增） |
| `waitAlertGone(page, { sel, timeout })` | 等提示浮窗（wsemi `domAlert`＝w-component-vue `WAlert`／`vo.$alert`，id 以 `alt-` 開頭）全部消失；反應目標不是浮窗本身（例：同一訊息之行內紅字）時，浮窗在不在畫面上取決於時序，先等反應目標就緒再等浮窗消失才截圖，取代「固定等 N 秒」順帶等過浮窗之寫法；逾時拋錯含仍在之浮窗數 | 瀏覽器（2026-09-28 自 w-web-sso login E2E-016 抽出） |
| `canvasInkRects(page, rects, { canvas, alpha, bg, trimY })` | 讀 canvas 像素，把圖表程式庫回報之寬鬆矩形收斂到實際墨跡（左右；`trimY` 亦收上下），無墨跡回 `null`；canvas 預設以矩形中心點命中測試取得，亦可指定；未繪製處須透明（背景不透明者給 `bg` 改以色差判定）；支援高 DPI。用途：echarts／zrender 回報之文字與圖例項矩形比字形寬約 3px，直接交 `inkRect` 取鄰項中點會偏、框線貼到鄰項；被捲動窗裁掉一部分之項目只回可見部分，可作鄰項 | 瀏覽器（2026-09-28 自 w-web-perm 統計圖例抽出） |
| `composeBox` 之 `BOX_PAD`／`BOX_STROKE` | 框幾何預設值（外擴 6、線寬 5）集中匯出，量測端（`itemsUnionBox`、`inkRect`）據以把框線中心置於間隙正中（目標邊 ± 3.5） | 2026-09-28 |
| `composeBox(buf, box, opt)` | 截圖後以 sharp 合成紅框 #f26 / 5px / 圓角 4、外擴 6、夾邊留 3；過小不畫時呼叫 `opt.onSkip(reason)` | sso 實跑、單元 |
| `stepShots(page, opt)` | 「每步兩張」單步：框操作目標 → 操作 → 等反應 → 框反應；`before:null` 表示由前一步之後圖兼任（SKILL §7.3-1），`before` 省略即拋錯 | 單元（2026-09-28 新增，泛化自 perm `*WithShots` 與 sso `capturePermsChangeSave`） |
| `maskRegions` / `overlayRegions` | 截圖後填黑 / 以參考圖同座標貼回 | sso 實跑、單元 |
| `overlayImageAt` / `cropRegion` | 以裁切參考圖貼回（w-web-api 之作法） | 單元（sso 無呼叫端） |
| `pixelmatchOpt` | 比對端 pixelmatch 之判定選項（凍結物件 `{ threshold: 0.1, includeAA: false, checkerboard: true }`），本套件所有以 pixelmatch 計差異像素之處（`assertBaselineMatch`、`runBaselineCase`、`createBaselineGate` changed 模式、`writeBaselineIfChanged`、`compareImageDirs`、`reviewPendingShots`）之唯一預設來源，一律展開之；2026-11-09 起色差度量為 pixelmatch 8（OKLab HyAB），參數與理由見 §5〈pixelmatch 8 之比對度量〉 | 單元（`unit-compareMetric`） |
| `assertBaselineMatch(buf, path, label, opt)` | pixelmatch 8（OKLab HyAB；選項取自 `pixelmatchOpt`：`includeAA:false`、`checkerboard:true`、threshold 0.1）、maxDiffPixels 100；尺寸不同即敗；testPending 三聯組永不覆蓋（C9）；**只比對不寫檔**（原 `regen` 寫檔旁路 2026-09-28 移除，傳入即拋錯）；通過但計數超過上限 `headroomRatio`（預設 0.5）時印 `[baseline-headroom]` 告警；**收集模式**（`opt.collect`，預設關閉，§2.8）：案例範圍內之收集器啟用時不符照存證據但不拋錯、記錄並回傳該筆，缺標準圖亦收集（capture 為候選標準圖） | sso 實跑、單元 |
| `typeIntoInput` / `typeIntoNthInput` | Pattern D 真人輸入（C10） | sso 實跑、瀏覽器 |
| `waitUntilExist(page, label, fn, opt)` | 偵測驅動等待（C11），預設 10000ms；`fn` 為 async 函數時改逐次 `page.evaluate` 輪詢（`waitForFunction` 會把 Promise 當 truthy 立即放行） | sso 實跑、瀏覽器 |
| `pollUntil(label, fn, { timeout, interval })` | 測試行程端之偵測驅動等待：反覆執行 `fn`（可 async、可用閉包；拋錯視為未成立）直到回 truthy，回傳該值；逾時拋錯含判斷次數與最後一次錯誤。用於瀏覽器外之非同步結果——後端週期計時器寫入資料庫（封鎖、補登記）、背景程序產檔——取代「固定等 N 秒再讀」（計時器於負載高時延遲）；頁面內條件仍用 `waitUntilExist`。預設 30000／200ms | 單元（2026-09-28 自 w-web-sso autoblock 抽出） |
| `collectDomText` / `pageHasText` / `assertTextSpec` | 以 spec 衍生之期望文字做語意斷言（走訪 DOM 文字節點，不判可見性） | sso 實跑（tokens）、瀏覽器 |
| 【w-component-vue】`waitColResizeOverlay` / `waitDrawerReady(page, {timeout, selector})` | WDrawer 拖曳分隔條 opacity=1 / **只認 WDrawer 根節點**之 `state` 終態（C12；預設選擇器 `[state][changedrawerwidth]`，w-component-vue 2.5.35 起 WDialog、浮層 `.WPopperFix`、WListExpandItem、WGroupTags、WGroupDragdrop 之根節點亦帶 `state`，不再影響判定；`opt.selector` 可取代預設，傳 `'[state]'` 即還原 2.5.35 前之行為；`opt` 之非預期輸入〔`selector` 非字串／空白字串／無法解析、`timeout` 非大於 0 且不超過 2147483647 之有效數字、`opt` 非一般物件〕一律視為未給、改用預設而不拋錯，`opt.debug:true` 才警告（出口 `opt.funLog` 或 `console.warn`，固定詞彙、不含傳入之值、同鍵同因每行程一次）；元件改版後以 `node test/tools/probeWDrawerDom.mjs <w-component-vue 根目錄>` 複驗，Gitea #35） | sso 實跑、瀏覽器 |
| 【w-component-vue】`probeStuckTooltip(page, {rootSel, createError})` | 截圖前掛鉤（`captureStable` 之 `beforeShots`）：游標已移開後仍顯示之 hover 型提示框（WTooltip `mode='tooltip'`，文字不限）即拋錯，殘留畫面不凍結為標準圖；點開型浮層（`mode='popup'`：WPopup、下拉清單）不在此列。成因為點擊時游標下之節點被移除替換，而 Playwright ≤1.62 預設停用 `BoundaryEventDispatchTracksNodeRemoval`，mouseleave 未送達觸發區（w-component-vue 2.5.24 已修正 WButtonCircle 之成因，本函數為回歸守門）。以 WTooltip 內部結構辨識（`$refs.divTrigger`／`divContent`、`props.mode`、`data.valueTrans`），元件改寫時會靜默失效，升級 w-component-vue 須以真元件頁複驗 | 瀏覽器（2026-09-30 新增，收斂四專案各自手寫之同一實作） |
| 【ag-grid】`resetAgGridScroll` / `rowBoxSel` | 截圖前水平捲動歸零 / 整列框選兩選擇器（`order` 決定捲動對象） | perm / task 實跑、瀏覽器、單元（sso 未用） |
| 【ag-grid】`gridContentBox(gridSel, {noRowsSel, noRowsPad})` | 量測型目標：標頭 ∪ 可見資料列（空表為標頭 ∪「無資料」訊息），夾在表格框內；取代直接框 `.ag-root-wrapper`（列少時框進大片空白，SKILL §7.2 表格列）；欄位未撐滿表格寬、右側空白 ≥ 200px 且 ≥ 框寬 30% 時右緣收在最後一欄（撐滿者右側僅捲軸槽，不收）；空表之「無資料」訊息為無可見邊界之文字，外擴 `noRowsPad`（預設 `INK_PAD`=4）後再取聯集，與 `itemsUnionBox` 之 `fit`、`inkRect` 同一條文字留白規則（`noRowsPad:0` 為舊行為） | 瀏覽器（2026-09-28 新增；同日加欄寬收邊；2026-09-30 加空表訊息外擴） |
| 【ag-grid】`waitGridIdle(page, opt)` | 表格靜止：列內容＋容器 / 標頭 / 列幾何＋捲動量簽章連續 `stableMs` 相同；`minCells>0` 時表格未出現亦視為未就緒；取代雙重 rAF（SKILL §8.1 列為無效手法） | 瀏覽器（sso 5 檔 26 處替換中） |

### 1.2 產製與比對管線

| 檔 | 用途 | 狀態 |
|---|---|---|
| `getE2eMode(opt)` | `{ regen, diag, strictCapture }`；regen 且診斷 env 時拋錯（C13 閘門） | sso 實跑、單元 |
| `createBaselineGate(opt)` | `--names` / `--langs` / `--write-mode` / `E2E_BASELINE_OUT_DIR` 之解析與截圖前篩選（§2.2）；`finalize()` 另做孤兒檢查，並依 `noteKnownDefect` 之紀錄不把「因已知缺陷未產」當未命中、回傳 `{ knownDefects }` | sso 實跑（tokens）、單元 |
| `findOrphanBaselines(opt)` | 依案例宣告靜態比對標準圖目錄，列出不是任何案例宣告圖鍵之孤兒圖（與執行了哪些案例無關） | 單元（2026-09-28 新增；PERM 12 張孤兒殷鑑） |
| `runBaselineCase(opt)` | 單一案例管線，產製端與比對端呼叫同一函數（§2.1）；`collect`（比對端收集模式，§2.8）、`keepSame`／`keepMaxDiff`／`transient`（產製端有變更才改寫，§2.9）、`compareBuf`（比對端覆蓋兩端共用）皆預設關閉 | sso 實跑（tokens）、單元 |
| `createBaselineCollector(opt)` | 以案例為單位之比對收集器（§2.8）：`run(fn)` 以 AsyncLocalStorage 界定範圍，範圍內 `assertBaselineMatch` 之不符記錄並續行，正常結束時有不符即拋固定格式之彙整錯誤；預設依 `E2E_COLLECT==='1'` 啟用 | 單元（2026-10-28 新增，Gitea issue #19） |
| `writeBaselineIfChanged(buf, path, opt)` | 標準圖寫檔入口（§2.9）：`E2E_BASELINE_KEEP_SAME=1` 時以比對端同一覆蓋與容差判定，相同者不改寫（mtime 不變）；未啟用時直接寫出、不讀標準圖 | 單元（2026-10-28 新增，Gitea issue #19） |
| `normalizeShots(result, name)` | Buffer / 物件 / 陣列 / `{buf\|shots,page}` / null → `[{key,buf}]` | 單元 |
| `openCasePage(browser, opt)` | 每案新 context＋頁面＋對話框處理器 | sso 實跑（tokens）、瀏覽器 |
| `createKnownDefect(message, opt)` | 已知缺陷錯誤（SKILL §7.5）：整案缺陷產製端不寫圖、比對端 pending；帶 `shots` 者為部分缺陷，缺陷之前的圖照常產製與比對（§2.1） | 單元 |

### 1.3 生命週期與行程

| 檔 | 用途 | 狀態 |
|---|---|---|
| `createServiceManager(opt)` | 沿用政策（reuse）之啟動 / 重啟 / 收尾（C2 / C3，§2.4）；`services[].port` 為基準埠，探測、url、spawn 收到之 `port`、殺監聽者皆用 `E2E_PORT_OFFSET` 位移後之實際埠（§2.10），`portOf(name)` 回實際埠；自建之服務就緒後核對監聽者身分（`E2E_PORT_NOT_OWN`、`E2E_PORT_OWNER_UNKNOWN`），`restart` 查不到監聽者即拋錯 | sso 實跑、單元、`api-serviceOwner`（真實行程，2026-11-05） |
| `resolveE2ePort(basePort, opt)` | 基準埠＋`E2E_PORT_OFFSET`（未設、空或 0 原樣回傳）；專案組 baseUrl、設定檔之埠、`killPortListeners` 之對象皆經此（§2.10） | 單元、子行程實跑（2026-10-28 新增，Gitea issue #19） |
| `reserveE2ePorts(basePorts, opt)` | 自動換埠：沒有占用時即基準埠；被占用時整組移位並寫入 `E2E_PORT_OFFSET`；跨行程預約，同時開跑不會選到同一組（§2.12）；具名匯出 `assertE2eBasePort`（畫面含埠之流程確認跑在基準埠）、`createE2ePortClaimer`、`getActiveE2ePortReservation` | 單元、真實監聽行程（2026-11-05 新增） |
| `checkPortFree(port)` | 以實際綁定檢查埠（五種試綁定：`127.0.0.1`、`0.0.0.0`、`::`〔雙棧〕、`::1`、`::`〔`ipv6Only`；失敗時 `host` 記為 `'::(ipv6Only)'`〕）；具名匯出 `waitPortsFree` | `runShardedE2e`、`reserveE2ePorts` 共用（2026-11-05 自 `runShardedE2e` 抽出） |
| `reapShardProcesses(opt)` | 只殺身分已正面確認之行程並留紀錄（§2.11〈行程身分〉）；具名匯出 `listProcessTable`（Windows 優先作業系統 API，退回 `Get-CimInstance`，§5）、`sampleShardKnown`、`findProcessDescendants`、`describePortOwners`、`judgePortOwner`（埠之監聽者是否全屬某行程或其存活子孫，只查詢不下殺；`runShardedE2e` 亦轉出 `reapShardProcesses`、`listProcessTable`、`sampleShardKnown`、`findProcessDescendants`） | `api-shardKillIdentity`、`unit-shardProcIdentity`、`api-procTable`、`unit-serviceOwner`（2026-11-05 自 `runShardedE2e` 抽出） |
| `registerCleanupHooks(cleanup, opt)` | root after＋exit / SIGINT / SIGTERM；**須於模組頂層呼叫** | sso 實跑、單元 |
| `probeHttp(url, opt)` | 任何 HTTP 回應即 true；`accept` / `identify` 可收緊 | sso 實跑、單元 |
| `createTempSettings(opt)` | 臨時設定檔（JSON5 基底淺合併、tmpDir 必填、forbiddenKeys） | sso 實跑、單元 |
| `runIsolatedE2e(opt)` | 逐檔獨立 mocha 行程（殺 port 以回呼注入）；`targets` 逐檔指定檔案與 `--grep`（依差異範圍只重跑受影響案例，每檔仍換新後端，並自動加 `--fail-zero`，grep 對不到任何案例即失敗）；有 mocha 執行檔（`mochaBin`，預設 `node_modules/mocha/bin/mocha.js`，以 `projRoot` 解析）時以 node 直接執行、不經 shell，否則沿用 `npx`（Windows 下經 cmd.exe 重新解析參數：`\|` `&` 切出另一指令、`<` `>` 轉向、`^` `"` 被吃掉、空白拆開、`%名稱%` 展開；故此時參數含空白或 `"` `&` `\|` `<` `>` `^` `%` 即於執行前拋錯；括號與 `[ ]` 不受影響）；明確給定之 `mochaBin` 不存在即拋錯 | sso 實跑、單元（2026-09-30 加 `targets`、node 直接執行、npx 退路之參數守門） |
| `runShardedE2e(opt)` | 把專案之 e2e 檔分組，各組放進以埠位移之臨時實例同時跑、彙整後移除實例，只跑比對（§2.11）；`tools/shardE2e.mjs` 為其 CLI | 單元、真實小專案整合（2026-11-04 新增） |
| `planE2eShards(opt)` | 分組與記憶體守門之純函數：由大到小放入最輕之組、`officialOnly` 固定第 0 組、`together` 不拆開（§2.11） | 單元（2026-11-04 新增） |
| `listDirLinks(root, opt)` | 以不跟進連結之方式列出目錄內之連結（symlink、junction）；枚舉失敗拋錯，不視為沒有連結 | 單元（2026-11-04 新增） |
| `removeE2eInstance(opt)` | 移除一個臨時實例：搬回證據（不覆蓋）→ 拆連結 → 回驗清單為空且目標完好 → 遞迴刪除 → 確認不存在；任一步失敗拋錯（`err.step`）不做後續（§2.11） | 單元、真實小專案整合（2026-11-04 新增） |
| 所有權原語 `killOwnTree` / `isChildAlive` / `waitChildExit` / `pidExists` / `sleepSync` | 只殺自建且仍存活之子行程樹（同步）與回驗 | killOwnTree sso 實跑；其餘單元（移植自 w-web-task 並帶其測試） |
| port 政策原語 `killPortListeners(port, opt)` | 殺監聽某 port 之行程（含行程樹）——**只可用於專案專屬且已於映射表明文登錄之 port**；查詢固定傳 `useBoth: true`（殺行程須完整集合）；`opt.exec` 為 spawnSync 形，查詢與下殺共用（§5 Breaking changes）；查詢失敗回 `{ pids: null, killed: [] }` 不下殺 | sso 實跑（舊版）、單元、本機真實子程序（2026-10-30） |
| `listenerPids(port, opt)` | 查監聽某 port 之 PID（字串陣列、去重排序）：委由 wsemi `execProcessPortPidsSync`，判定不依狀態欄；Windows 先 `netstat -ano`、查無或失敗再 `Get-NetTCPConnection -LocalPort` 確認（本機 Windows 11 26300 之 netstat 會漏列新起之監聽、並把對外連線之狀態錯置為 LISTENING），其他平台 `lsof`；`[]` 只代表已確認無人，查詢失敗回 `null`（不可當成無人）；透傳 `timeout`／`useBoth`／`onTrace`／`exec`／`platform`；**耗時**（`useBoth:true`，wsemi ≥ 1.9.50 之作業系統 API 路徑，實測）：無負載約 0.4 秒；1.2 萬條 TCP 連線約 0.8～1 秒（不隨連線數增加）；CPU 2 倍超載約 12.5 秒；CPU 4 倍超載加 2000 條連線約 20 秒、最長 25.5 秒；退回 `Get-NetTCPConnection`（受限語言模式）時隨連線數增加，1.2 萬條約 13 秒；本套件自身之查詢一律用 `PORT_QUERY_TIMEOUT_MS`（60 秒，具名匯出；太短會把系統忙碌當成查詢失敗），只有 exit／signal 處理器內（行程要儘快結束）才傳較短 `timeout`；**身分確認（「監聽者恰為我的子程序」）請傳 `useBoth: true`** | sso 實跑（舊版）、單元、本機真實監聽（2026-10-30） |

### 1.4 驗證工具

| 檔 | 用途 | 狀態 |
|---|---|---|
| `snapshotBaselines(dir)` / `diffBaselineSnapshots(a, b)` | 標準圖 sha256＋mtime 快照與比對；「內容相同但被重寫」亦列出 | sso 實跑、單元 |
| `compareImageDirs(dirA, dirB, opt)` | 兩目錄同名 PNG 逐檔比對：位元組相同 ⊂ RGBA 相同 ⊂ 容差內；另報 `rgbaDiff`／`rgbaDiffBox`，`equivalent`＝RGBA 相同或相異像素全在 `opt.drift` 登錄漂移點內（**不以 pixelmatch 計數 0 為等價**：threshold 0.1 下均勻約 23～29 級〔隨明度，近黑較敏感、近白較寬〕以內之亮度差不計） | sso 實跑、單元 |
| `reviewPendingShots(opt)` / `acceptPendingShots(opt)` | 收集模式單趟執行後之審查與採用（§2.8）：前者讀 `./testPending` 各標籤最新一組證據，分類 SAME／NOISE／CHANGED（附差異外框、可產並排裁圖）／SIZE／MISSING 並帶出所屬案例與結果，只讀；後者只把 `labels` 明列者之 capture 複製為正式標準圖，先全部驗證（無證據、所屬案例另因錯誤失敗、證據過期、無標準圖路徑皆拒收）才複製 | 單元（2026-10-28 新增，Gitea issue #19） |
| `tools/shardE2e.mjs`（CLI） | `node node_modules/w-package-tools-e2e/tools/shardE2e.mjs [--plan] [--ports <埠,...>] [--instances <N>] …`：`runShardedE2e` 之命令列（§2.11）；離開碼 0 全部通過、1 有失敗／未跑完／收尾失敗／開跑前之問題、2 參數錯誤、128＋訊號值 收到終止訊號 | 真實小專案整合（spawn 實跑） |
| `tools/reviewPending.mjs`（CLI） | `node node_modules/w-package-tools-e2e/tools/reviewPending.mjs [--pending <dir>] [--since <時間>] [--max-diff <N>] [--crops <dir>] [--json <out>] [--accept <標籤,...>] [--root <dir>] [--dry-run]`：未給 `--accept` 只審查、不改寫任何標準圖（裁圖排他建立、不覆蓋）；`--accept` 任一標籤不合格即全部不採用並以離開碼 1 結束；參數錯誤離開碼 2 | 單元（spawnSync 實跑） |
| `tools/auditWaits.mjs`（CLI） | 固定等待盤點：`node node_modules/w-package-tools-e2e/tools/auditWaits.mjs [--only C,E,R] [--json <out>] <專案根目錄...>`；掃 `test/*.test.mjs` 與 `test/tools/*.mjs` 之每個 `waitForTimeout`，依前後語句分七類——A 偵測後之 settle、B 緩衝後接偵測、L 輪詢間隔、R 隨即離開函式（看呼叫端）、C 後接截圖／讀取／斷言（「固定秒數為唯一同步」候選）、D 後接操作、E 其他。旗標僅為候選：C／E／R 逐一判讀前一動作到預期狀態之間有無非同步來源（伺服器往返、轉址、計時器、廣播、防抖），有則改偵測（頁面內 `waitUntilExist`、瀏覽器外 `pollUntil`）；spec 規定之時間與負向斷言之觀察窗照留 | 單元（2026-09-28 自 w-web-sso 盤點腳本定稿；該日盤出 SSO 251／PERM 67／API 8／TASK 26 處） |
| `tools/auditBoxes.mjs`（CLI） | 標準圖紅框盤點：`node node_modules/w-package-tools-e2e/tools/auditBoxes.mjs [--out <json>] <pics目錄...>`（遞迴、略過 `_` 參考片）；六類候選——`noBox` 無框（#f26 長段 < 20px，SKILL §7.6-3）、`fullFrame` 整張一框、`blank` 框內大片空白（底部 ≥ 120px 且 ≥ 30%，或右側 ≥ 200px 且 ≥ 30%，§7.3-2）、`black` 框內遮黑方塊（§8.2）、`touch` 紅框壓字（§7.3-8）、`cut` 框線外緣緊貼框外字形（框線壓到相鄰內容，§7.3-9）。旗標僅為候選，缺陷與否逐類裁框目視（彈窗／抽屜面板內留白、整列框、元素邊界貼框、有遮罩彈窗之框外背景屬合規） | 2026-09-28 自 w-web-sso 五支掃描器合併；四專案 1024 張與五支舊掃描器逐類計數相同（6/12/105/12/189）；同日加 `cut` |

## 2. 通用規格

### 2.1 產製與比對同管線（C13、SKILL §7.10）

`runBaselineCase({ mode:'regen'|'compare', lang, name, launch, run, pathOf, ... })`：

```
prepare(ctx) → launch() → openPage(browser) → beforeRun(ctx) → run(page, lang, ctx) → normalizeShots
  → semantic(ctx) → verify(ctx)
  → regen：逐張 gate.shouldWrite → gate.decideWrite(write-mode) → writeBaselineIfChanged（有變更才改寫，§2.9；未啟用即直接寫）→ 寫入 gate.outPath(pathOf())
    （逐張印日誌：未點名 [skip]、保留 [keep] (原因)、寫出 [write] (原因，如 diff=661px)）
    compare：逐張 [compareBuf(buf, pathOf(), ctx)] → match(…, pathOf(), labelOf())（預設首張不符即拋；compareAll 則比完彙總；收集模式則全部記錄，§2.8）
  → finally：關瀏覽器（含 run 中換的 ctx.browserRef.current）→ afterCase(ctx)
  → 收集模式：以上全程在收集器範圍內；正常結束後有不符即拋彙整錯誤
```

- **全部斷言通過才寫檔**：任一 semantic / verify 失敗，該案一張都不寫。
- 掛鉤收 `ctx = { mode, lang, name, browser, browserRef, page, shots, result }`。只能在測試框架內執行之檢查（例如無法關閉之第三方 API client，SKILL §9.1 只准 api 測試層 root after 強制退出）以 `ctx.mode === 'compare'` 限定，並於測試檔註明依據——**產製端不得以 process.exit 繞過**。
- describe / it、標題、群組、額外之手寫 it 留在測試檔；測試檔之 regen 迴圈與 mocha 之 it 皆呼叫同一個 `runBaselineCase` 與同一組掛鉤。
- `allowEmpty` 預設 false：案例未產生截圖即拋錯（防比對端空轉假綠）。
- `compareOnly`（共用他案標準圖之案例，SKILL §7.8 ①）：產製端照跑流程與全部斷言、一張都不寫，回傳 `status:'compareOnly'`（避免同一張被兩案輪流重寫，w-web-api edit E2E-005 殷鑑）；比對端照常比對。案例直接宣告其比對之共用圖鍵為 `stages`，run 回傳 `{ 共用圖鍵: buf }`（裸 Buffer 以案例鍵命名，會與宣告不符）；fail-dump 標籤宜帶案例名以分辨哪一案失敗。
- `gate` 給定時，`runBaselineCase` 以 `gate.usePathOf(pathOf)` 告知標準圖路徑函數，供 `finalize()` 之孤兒檢查。
- `stages`：給定時產出圖鍵集合須與宣告相同，否則拋「多 [...] 少 [...]」（防宣告、產製、比對三處命名不同步）。
- 已知缺陷（整案）：run 中拋 `createKnownDefect(...)`（不帶 `shots`）→ 產製端不寫圖、回傳 `status:'knownDefect'`、有給 `gate` 時自動 `gate.noteKnownDefect(...)`；比對端呼叫 `onKnownDefect`（mocha：`() => this.skip()`），之前不比對任何一張。
- 已知缺陷（部分，缺陷落在案例後段）：run 中拋 `createKnownDefect(msg, { ref, shots })`，`shots` 為缺陷**之前**已取得之截圖（格式同 run 之回傳），並給 `stages` 與 `defectStages`（缺陷步之圖鍵，須為 `stages` 之子集且須與 `stages` 併用，組態錯誤於開瀏覽器前拋錯）：
  1. 圖鍵三向核對（`shots` 圖鍵 K、`stages` S、`defectStages` D）：多＝K−S（拼錯）、重疊＝K∩D（壞畫面混入）、少＝S−K−D（缺陷早於預期），任一非空即拋「已知缺陷時產出之圖鍵與宣告不符」，一張不寫、不呼叫 `onKnownDefect`；`stages` 已宣告而未給 `defectStages` 時 D 視為空（K 須等於 S）；`stages` 未宣告則不核對。
  2. 前段仍先過 `semantic`、`verify`（`ctx.knownDefect` 為該錯誤、`ctx.shots` 為正規化後之前段截圖 `[{key,buf}]`，既有掛鉤須能以 `ctx.knownDefect` 分流；`ctx.knownDefect.shots` 為使用者原始形狀，掛鉤一律以 `ctx.shots` 為準）；掛鉤重新指定 `ctx.shots` 者，其後寫出／比對的是替換後之內容（與正常路徑一致）；`err.shots` 為 `{shots,page}` 形狀時，其後掛鉤與 `afterCase` 收到新 page（同正常路徑）；掛鉤拋一般錯則一張不寫；掛鉤另拋不帶 `shots` 之已知缺陷則降級為整案（`out.shots`／`ctx.shots` 仍為 run 已取得者且不寫，`out.defectStages` 與 `ctx.knownDefect` 移除）。前段為空而未宣告 `stages` 時與正常路徑一致須 `allowEmpty`；`defectStages` 給空陣列等同未給。
  3. 產製端：前段走與正常路徑同一個寫檔迴圈（`gate` 篩選、`--write-mode`、`E2E_BASELINE_OUT_DIR` 皆同），印 `[known-defect] … 前段 N 張照常處理, 未產 [D]`，回傳 `status:'knownDefect'` 並帶 `defectStages`（該欄存在，含空陣列，即為部分缺陷；整案缺陷無此欄）；`compareOnly` 則只列 `skipped`、不寫。缺陷步之既有凍結標準圖保留、不再比對、不算孤兒，修復後首次比對若失敗，依全域技能 §7.9 判定是否重產。
  4. 比對端：前段逐張比對（`compareAll` 同），**全部一致才呼叫 `onKnownDefect`**；任一張不符或標準圖缺檔即拋比對錯誤、不呼叫 `onKnownDefect`（前段回歸不被 pending 掩蓋）。
  5. 帶 `shots` 之已知缺陷**僅能由 run 拋出**；由 run 之前（prepare／launch／openPage／beforeRun）或 `semantic`／`verify` 拋出者視同一般錯並載明原因。缺陷修復後 run 走完全部階段即回到正常路徑（`stages` 檢查仍為全部圖鍵）。
  6. 未帶 `shots`、未給 `defectStages` 者，`runBaselineCase` 之行為（日誌、回傳欄位、`status`、`onKnownDefect` 時序）與 1.0.8 完全相同；與 `gate` 併用時 `gate.finalize()` 之變更見 §2.2。1.0.8 對 `createKnownDefect` 之 `shots` 為靜默忽略，此後生效。

### 2.2 篩選語法（`createBaselineGate`）

- 案例宣告：`cases: [{ name, stages?, compareOnly?, langs? }]`。多階段案例宜宣告 `stages`（使篩選於截圖前即可驗證）；`compareOnly` 為共用他案標準圖之案例（SKILL §7.8 ①）。
- `--names a,b,...`：每項可帶 `<語系>-` 前綴（限該語系），不帶則套用全部已選語系。解析順序：
  1. 完全等於已宣告之階段圖鍵 → 只寫該張（案例鍵＝首張階段圖鍵者亦只寫該張）；
  2. 完全等於案例鍵，或為案例鍵之**邊界前綴**（`E2E-005` 命中 `E2E-005-x`，不命中 `E2E-0051-x`）→ 寫該案全部階段；
  3. 為已宣告階段圖鍵之邊界前綴 → 寫命中之各張；
  4. 案例未宣告 stages 而編號相符 → 執行該案、只寫相符者；執行後未產出由 `finalize()` 拋錯；
  5. 命中 compareOnly 案例、或不符任何鍵 → **拋錯並列出可用鍵**（不靜默略過）。compareOnly 案例宣告之共用圖鍵不參與寫檔解析（`--names <共用圖鍵>` 只選產圖之案例）。
- 未篩選（全部案例）時 `casesFor` **含 compareOnly 案例**（產製端照跑其流程與語意斷言、不寫圖；2026-09-28 前直跑型專案之產製端從不執行只比對案例，與 mocha REGEN 型不一致）。
- 孤兒檢查：`createBaselineGate({ ..., pathOf })` 或由 `runBaselineCase` 告知後，`finalize()` 以 `findOrphanBaselines` 靜態比對「全部案例（含 compareOnly）× 案例語系 × 宣告 stages」與標準圖目錄（`<flow>-<lang>-` 前綴；`_` 開頭之參考片段自然排除；未宣告 stages 之案例以編號前綴為其所有），有孤兒即拋錯列出。不依賴執行紀錄，故 `--grep`／`--names` 局部執行、案例失敗、knownDefect 皆不致誤報。
- `--langs` 須完全等於已宣告語系；與 `--names` 之語系前綴衝突即拋錯。旗標缺值或其值以 `--` 開頭即拋錯（防 `--names --langs cht`）。
- `--write-mode all|missing|changed`：all（預設）全寫；missing 只寫標準圖不存在者（追加案例，SKILL §7.9）；changed 只寫與現行標準圖差異超過容差或尺寸不同者（不重寫已審過之圖）。
- `E2E_BASELINE_OUT_DIR`：寫檔改導至該目錄（等價驗證用）；比對端讀取之標準圖路徑不受影響。**只涵蓋經 `runBaselineCase` 之寫檔**；參考片段自舉、測試檔自行 `fs.writeFileSync` 之處未遷移前不得用 outDir 做等價驗證。
- 已知缺陷之紀錄：`gate.noteKnownDefect(lang, caseName, { keys, message, ref })` 由 `runBaselineCase` 於缺陷分支自動呼叫（自寫包裝若不經 `runBaselineCase` 須自行呼叫）；`keys` 省略或 `null` 代表整案未產，陣列則為本次因缺陷未產之圖鍵（`defectStages`）。`finalize()` 之 `--names` 未命中改為「未產出且未被已知缺陷涵蓋」：
  - 整案缺陷：該案被 `--names` 選中之全部項目（案例鍵、邊界前綴、階段圖鍵）依協定不產圖，不再拋錯；
  - 部分缺陷：命中缺陷步圖鍵之項目豁免，命中前段圖鍵之項目仍須由 `noteProduced` 判已產（`--write-mode` 之 keep 亦算）；
  - 案例根本未被執行（沒有紀錄）、圖鍵拼錯之正常案例（宣告 `stages` 者於構造時即拋；未宣告 `stages` 之④路徑者由 `finalize` 拋）照舊拋錯；缺陷已修復則 run 走完、缺陷步照常寫出，無缺陷紀錄；
  - 已知限制：①未宣告 `stages` 之案例整案缺陷時，④前綴項目（含拼錯者）無法驗證圖鍵、不拋，摘要仍列該案；部分缺陷而未宣告 `stages` 時缺陷步無從豁免（點名缺陷步圖鍵者由 `finalize` 以未產出拋），摘要註明「未列缺陷步圖鍵」——缺陷案例請宣告 `stages` 與 `defectStages`。②`produced` 與缺陷涵蓋皆以 `--names` 項目為單位（any-of）：無語系前綴之項目選中多語系／多案例時，任一目標已產出或記缺陷即視為命中，其餘目標若根本未被執行不會被個別追蹤（`noteProduced` 一向如此）；要逐目標嚴格請帶 `<語系>-` 前綴逐案點名。③`noteKnownDefect` 僅由產製端（`mode:'regen'`）通知，`keys` 須省略／`null`（整案）或圖鍵字串陣列（含空陣列），其餘型別拋錯。④`finalize()` 回傳為獨立快照，無冪等保證（每次呼叫皆重印摘要）。
- 產製前印 `gate.describe()`（跑案例前呼叫，不含缺陷紀錄）；全部案例跑完呼叫 `gate.finalize()`：有缺陷紀錄時先以 `log`（`createBaselineGate` 選項，預設 `console.log`，給 `null` 不印）印出「已知缺陷未產」摘要，再判未命中與孤兒；通過時回傳 `{ knownDefects: [{ lang, name, keys, message, ref }] }`。

### 2.3 截圖穩定化序列（`captureStable`，C6）

停滑鼠 (0,0) → `initialWaitMs`（1500）→ `settle[]`（元件狀態機優先，如 WDrawer）→ 凍結 inline SVG SMIL → `document.fonts.ready` → `beforeShots[]`（如 ag-grid 歸零）→ 偵測 `<img>` 內含 `<animate>` 之 SVG 區域 → 連拍：每張先處理該區、再與前一張逐位元比對（8 × 200ms），相同即回傳；用盡時 strict 拋錯、否則回傳最後一張交比對揭露 flake。

- `<img>` 動畫區之處理 `imgSmilFill`：`'static'`（**預設**）以區外左側像素色填底，再貼上以 sharp 算繪之「去掉動畫元素之 SVG」靜態影格——手冊用圖看得到真實圖示，且輸入固定故輸出決定；區域超出截圖邊界者退回填黑。`'black'` 為一律填黑之舊行為（2026-09-28 前），僅供等價對照。
- `strict`：布林時依之；未給（或 null）時呼叫 `strictDefault()`，**每次呼叫時求值**（預設讀 `E2E_STRICT_CAPTURE==='1'`；mocha REGEN 專案傳 `() => REGEN`）。
- `shotOpts` 與 `{ fullPage:true, animations:'disabled' }` 淺合併（SKILL §8.5 之 `fullPage:false`、clip）。
- `smilRectBasis`：`'auto'`（**預設**：全頁截圖用 `'page'`、視窗截圖用 `'viewport'`）、`'page'`（視窗座標加捲動量＝全頁截圖之座標系）或 `'viewport'`；給 `shotOpts.clip` 時一律再減去 clip 原點。**已修正之潛在缺陷**：2026-09-28 前四專案之全頁截圖皆用視窗座標（今以 `'viewport'` 重現，只供等價對照），頁面已捲動時遮罩落錯位置、動畫露出，且 Chrome 暫停視窗外之 `<img>` 動畫 → 連拍「穩定」但停在不固定影格；頁高不超過視窗者兩者等價（`test/e2e-captureEquivalence.test.mjs` 實證舊行為之缺陷與新預設之正確性）。
- 紅框（`captureStableWithBox`）：第一個非矩形目標先捲入視窗 → 300ms、停滑鼠 → **截圖前**量目標、遮罩與捲動量 → capture → 遮罩 → 紅框（框永遠可見）。`clampTo:'buffer'|'viewport'`、`guardSmall`、`boxOpts`。
- 量測型目標（2026-09-28）：框之對象由頁面內容決定時（表格有幾列、清單有幾項），直接框容器會把空白一起框進去（四專案掃描 1018 張中 128 張框內底部或右側空白帶 ≥ 30%，今為 `tools/auditBoxes.mjs` 之 blank）。`gridContentBox`／`itemsUnionBox` 回傳 `{scroll, measure}`：捲入 `scroll` → 等待 → `measure(page)` 於頁內量聯集 → 與其他目標再取聯集；量不到回 `null` 即依無框防護拋錯。
- 紅框壓字（2026-09-28）：框幾何為目標 ±6、5px 描邊內縮 → 框內緣距目標矩形 1px；目標自帶內距或可見邊界時觀感正常，目標為「無可見邊界且緊貼文字」之元素時框即壓字（實測 login E2E-006、stainfor E2E-002 距 0px；四專案掃描今為 `tools/auditBoxes.mjs` 之 touch）。對策不改全域框幾何（會牽動上千張既有圖），而於量測端處理：DOM 目標經 `itemsUnionBox(..., {fit:true})`，canvas 矩形經 `inkRect`，可見內容（文字與勾選框、開關軌道、圖示等子元素）一律外擴 4px（框內留白約 5px）。

### 2.4 服務生命週期（`createServiceManager`，C2 / C3、SKILL §9）

- **沿用政策（reuse，v1 唯一支援）**：port 有回應即沿用（不 spawn、不負責關），否則 spawn 並等就緒；只殺自建。前提：該 port 專屬本專案（沿用時無法確認對方跑的是哪份設定與版本，SKILL §9.1 規定 health 回專案識別才沿用——`probeHttp` 之 `identify` 可用，四專案皆尚未提供識別端點）。
- 每服務一個一次性狀態，進行中之呼叫共用同一 promise；`failureMode:'once'`（預設：首次拋錯、之後不重試不拋錯）或 `'sticky'`（之後持續拋同一錯誤至 cleanup）。
- `restart(name, { args, env, hookArg })`：有自建 → 同步殺樹並等 port 釋放（上限 `portReleaseTimeoutMs`）；殺後仍被佔（另有同專案實例，例如手動啟動者）或無自建而 port 被佔 → `killForeignOnRestart:true` 才殺監聽者（無自建時預設 false 拋錯；殺自建後仍被佔且未允許者只記錄並繼續，由其後之就緒核對把關）；**監聽者查不到（`null`、行程表查不到）時重試，共 3 次仍查不到即拋錯，不續行**——續行的話新服務因埠被占而結束，就緒探測卻由占用者回應；env 與 process.env 淺合併且只作用於本次；**restart 不改一次性狀態**。
- **就緒核對**（自建之服務：`startServersOnce` 確定要 spawn 者與 `restart`）：就緒探測只知道埠有回應，不知道是誰回應。探測通過後確認該埠之**每個**監聽者都是 spawn 回傳之行程或其存活子孫（Windows 允許不同位址同時監聽同一埠，有他人在場連線就可能落到對方）：

  | 結果 | 處置 | `err.code` |
  |---|---|---|
  | 全屬本服務 | 放行，之後才 `noteOwn` | — |
  | 其中有他人（偵測與綁定之間被占走、服務靜默改埠） | 重試共 3 次（他人之 portfinder 試綁定、舊實例結束中皆片刻即離開），仍有他人即拋錯，寫明埠與占用者；**不下殺占用者**，只收掉自建之服務 | `E2E_PORT_NOT_OWN` |
  | 探測有回應而查無監聽者 | 同上 | `E2E_PORT_NOT_OWN` |
  | 查詢失敗（監聽者或行程表回 `null`） | 重試共 3 次，仍查不到**不當成自己人**：拋錯，收掉自建之服務，不下殺；多因系統負載過高，可重跑 | `E2E_PORT_OWNER_UNKNOWN` |

  沿用既有服務（port 已有回應而未 spawn；含 `E2E_PORT_OFFSET=0` 手動鎖埠）**不核對**，語意照舊。**launcher 先結束、真正服務由孫行程接手之寫法無法判定**（中間行程已死即斷鏈，`E2E_PORT_NOT_OWN`）：請直接 spawn 服務；`shell:true`、`npm run serve` 這類 launcher 全程存活者可以判定。確實無法以行程鏈判定之服務（例如容器）以 `opt.verifyOwner(svc, child)` 自行確認身分。測試之假 child 同樣以 `verifyOwner` 略過。重試間隔 `opt.ownerRetryMs`（預設 1000）；查詢之執行函數 `opt.exec`；觀察回調 `opt.onTrace`（事件 `owner-check`：`service`、`port`、`attempt`、`result`、`owners`；`restart-query`：`service`、`port`、`attempt`、`ok`）。
- 服務之 `beforeSpawn({ phase, args, env, hookArg })`：每次 spawn 前呼叫並等待，`phase` 為 `'start'`（startServersOnce 確定要 spawn 時；沿用時不呼叫）或 `'restart'`（`hookArg` 取自 restart 之 opt）——供「服務啟動前必須完成」之前置：w-web-api 首次啟動前 `npm run build`、w-web-perm 首次啟動前重建資料庫與 `restart(…, { hookArg:{ reseed:true } })` 之重新播種。
- `cleanup()`：同步（exit / 訊號處理器內非同步不會被等待）、依 services 反序殺自建、重置一次性狀態、呼叫 `onCleanup`。觸發來源兩條：`registerCleanupHooks`（root after＋exit / 訊號備援）與直跑主函式末尾顯式呼叫。
- **own 政策 v1 不支援**（只用自建、port 被佔即報錯、綁定失敗字樣偵測、監聽者回驗、跨行程互斥）；參考實作為 w-web-task `test/tools/harnessLifecycle.mjs`。
- 埠位移（`E2E_PORT_OFFSET`）：`services[].port` 為基準埠，管理器內部一律用實際埠，見 §2.10。

### 2.5 路徑與暫存

標準圖、`./testPending/` 以 cwd（專案根）相對；臨時設定與測試中介資料落 `test/_tmp/`（`createTempSettings` 之 tmpDir 必填，由專案給定），測完即刪；`./tmp/` 為 AI 暫存區，測試禁用。

### 2.6 環境變數與命令列旗標

| 名稱 | 讀取之模組 | 作用 |
|---|---|---|
| `--baseline`、`E2E_REGEN=1` | `getE2eMode` | 標準圖產製模式（`regen:true`） |
| `E2E_BARE`、`E2E_DIAG` | `getE2eMode` | 診斷環境（`diag:true`）；與 regen 併用即拋錯，不在診斷態寫入正式標準圖 |
| `E2E_STRICT_CAPTURE=1` | `captureStable`（`strictDefault` 之預設）、`getE2eMode` | `strict` 未給時連拍用盡仍未穩定即拋錯 |
| `E2E_COVER_CHECK` | `captureStableWithBox` | 被蓋住檢查模式：未設為 `throw`，可設 `warn`（只印 `[box-covered]`，全量盤查用）或 `off`；`opt.coverCheck` 優先 |
| `E2E_BASELINE_OUT_DIR` | `createBaselineGate`（`outDirEnv` 可改名） | 產製寫檔改導至該目錄（等價驗證用），比對端讀取之標準圖路徑不受影響 |
| `E2E_BOX_DEBUG` | `itemsUnionBox` | 有值時印出各元素之可見範圍、浮層矩形、浮層外最近內容（`near`）、命中之圖形（`graphic`：邊 → 描述@視窗座標）與夾邊前後（審圖查因用） |
| `--names`、`--langs`、`--write-mode` | `createBaselineGate` | 產製篩選，見 §2.2 |
| `E2E_COLLECT=1` | `runBaselineCase`（`collect` 之預設）、`createBaselineCollector`（`enabled` 之預設）、`getE2eMode`（互斥閘門） | 比對端收集模式（§2.8）；未設時不變；與產製模式互斥（`--baseline`／`E2E_REGEN=1` 併用即拋錯）。`assertBaselineMatch` 本身不讀它（範圍外照常拋錯） |
| `E2E_BASELINE_KEEP_SAME=1` | `writeBaselineIfChanged`、`runBaselineCase`（產製端） | 有變更才改寫（§2.9）；未設時不變 |
| `E2E_BASELINE_KEEP_MAXDIFF` | 同上（僅 `KEEP_SAME=1` 時讀取並驗格式） | 保留之差異上限（非負整數；未設＝比對端容差 `maxDiffPixels`，預設 100；`0`＝只保留 RGBA 逐像素相同者） |
| `E2E_PORT_OFFSET` | `resolveE2ePort`、`createServiceManager` | 加到各基準埠（非負整數；未設、空或 `0` 不變），§2.10；`runShardedE2e` 依組序設定 |
| `E2E_SHARD_RESULT` | `tools/shardE2eReporter.cjs` | 各組統計 JSON 之路徑（`runShardedE2e` 設定，使用端不必理會） |
| `E2E_PORT_HOLD` | `reserveE2ePorts`、`runShardedE2e` | 上層已保留埠之識別碼，子行程繼承即沿用上層之位移、不再換埠（§2.12；使用端不必理會） |
| `E2E_PORT_REG_DIR` | `reserveE2ePorts`、`runShardedE2e` | 埠預約之登錄目錄；未設為 `<家目錄>/.w-package-tools-e2e/port-reservations`（§2.12；同一台機器之行程須看到同一目錄才互斥，只有測試才改） |

### 2.7 `itemsUnionBox` 之圖形內容（`graphics`、`graphicAreas`；Gitea issue #6）

**問題**：`fit:true` 之浮層規則（`position:fixed` 下拉清單、浮出面板）原以命中測試找浮層四周之內容，遇祖先寬 > 480 或高 > 120 即中止，大型 svg 內之圖形與 canvas 像素因此判為無內容，框線外擴蓋到其下之資料波形（以真 Highcharts／Plotly／ECharts 實測，浮層疊在圖表上時 360 個位置中 265 處框線帶蓋到資料線）。

**作法**：
- `graphics`（預設 `true`）：svg 圖形（`path/line/polyline/polygon/rect/circle/ellipse/text`）以 `getScreenCTM` 反矩陣與 `isPointInStroke/isPointInFill` 幾何判定（`pointer-events:none` 之 Plotly、全透明追蹤線之 Highcharts 皆正確；含 viewBox、CSS 縮放/旋轉）；可見性含累積 opacity、stroke/fill 透明度（含 `color(display-p3 …)`、`oklch()`、`lab()` 之 alpha）、漸層色標、祖先 overflow 裁切、clip-path、被有底色或不透明之層蓋住、svg 文字逐 `tspan` 判可見；撐滿圖表之 `rect` 與填色同圖表底色者（圖表背景，黑底圖表亦同）不算內容。2d canvas 以 `drawImage` 分塊讀像素（不對來源呼叫 `getContext`；位圖只畫在內容盒，已扣 border/padding 並依 `object-fit` 換算），與其所在 16×16 小格之背景色有對比者為墨跡（**均勻大色塊視為背景**）。
- `graphicAreas`：選擇器字串或其陣列，命中元素之矩形整區視為內容（位於浮層內、被遮罩蓋住者不算）；用於 img、video、WebGL 與跨域污染之 canvas、地圖、熱圖，以及含旋轉/翻轉變換之 canvas。例：`itemsUnionBox('.WPopperFix:visible', { fit: true, graphicAreas: '#map canvas' })`。
- **只增不減、最小介入**：舊規則回非 null 之點結果不變；圖形只在框線帶（量測矩形邊外 1 至 6px，另含緊鄰矩形邊之一列/行作守距）內有墨跡時才介入，沿矩形邊全長逐 px 取樣、四向同一算法；矩形內（含 `inkPad` 區）之內容框線蓋不到，不介入；框線外緣退到內容前 1px（剛好不蓋；不似 HTML 鄰項取間隙正中），框內緣不越過文字，放不下 5px 描邊時退回間隙正中。寬與高皆不大於 480×120 之小 svg/canvas（圖示、迷你圖）舊規則已以整個元素框為內容，不重複判定。
- **`graphics:false` 逐位元重現 1.0.9**；`fit:false` 不受影響。

**受影響者（發版說明）**：`position:fixed` 非全畫面浮層之 `fit:true` 量框，且框線帶內有 svg 圖形／可讀 2d canvas 之墨跡／宣告區者，框線改退入浮層內距；其餘（無圖形、圖形距框線帶外、小 svg/canvas、`fit:false`）不變，以隨機差分（現行 vs 新版量框逐位元相同）與既有等價測試證明。使用端升版後跑一次比對，失敗者即為受影響之圖，取得授權後以 `--write-mode changed` 重產並逐張審（全域技能 role-coder-for-test-e2e §7.9）；使用端以逐點補丁（如只收下緣之 `insetBox`）處理者可改用本規則並刪除補丁。不想改動者逐處給 `graphics:false`。

**已知限制**（不在本版處理；以 `graphicAreas` 可改以宣告處理者另註）：

| # | 限制 | 方向 | `graphicAreas` |
|---|---|---|---|
| L1 | 框線四角 6×6 小方格內之孤立圖形（完全落在角落、與四邊之掃描帶及緊鄰守距列皆不相交者） | 漏蓋（至多數 px²） | 否 |
| L2 | shadow DOM 內之 svg/canvas | 漏蓋 | 否 |
| L3 | svg 之 `<use>` 引用、`<image>`、`marker`（含 `marker-mid` 圓點） | 漏蓋 | `<image>` 可 |
| L4 | `mask`、`filter`、CSS `filter` 使圖形不可見者仍視為可見 | 多退 | — |
| L5 | 漸層填色之透明段整體視為可見 | 多退 | — |
| L6 | 巢狀 svg 之視埠裁切 | 多退 | — |
| L7 | 被 `pointer-events:none` 之不透明元素蓋住之圖形 | 多退 | — |
| L8 | 含旋轉/翻轉 CSS 變換之 canvas、`object-position` 非置中之 object-fit canvas（不自動判定） | 漏蓋 | 可 |
| L9 | WebGL canvas（僅 `preserveDrawingBuffer:true` 者讀得到像素，其餘讀得空白）／跨域污染 canvas、`<img>`、`<video>`（不自動判定）；位於圖形上方之不可讀 canvas 保守視為蓋住其下之圖形 | 漏蓋 | 可 |
| L10 | 面積 ≥ 50% 之 `rect` 一律視為底色（含有色者）；canvas 之均勻大色塊（地圖多邊形內部、熱圖大色格）視為背景 | 漏蓋 | 可 |
| L11 | `position:absolute` 浮層（浮層規則本就只對 `position:fixed`，舊限制） | 漏蓋 | — |
| L12 | iframe 內之圖表 | 漏蓋 | — |

### 2.8 收集模式（`E2E_COLLECT=1`；Gitea issue #19 第 1 項）

**用途**：全量比對時不因第一張不符而中止案例，一趟拍完每個案例之全部階段，事後統一審差異與採用，省掉「重產趟」。**預設關閉**；未設 `E2E_COLLECT`、未給 `collect` 時行為與 1.0.10 相同（首張不符即拋）。

**啟用與歸案**：
- 收集只發生在**案例範圍內**：`runBaselineCase` 之比對端（`collect` 預設依 `E2E_COLLECT==='1'`）把整個案例（prepare 至案例末比對）包在收集器範圍內；不經 `runBaselineCase`、於 `it` 內逐階段呼叫 `assertBaselineMatch` 者，以 `createBaselineCollector({ caseKey }).run(async () => { … })` 包住案例本體（收集器預設依 `E2E_COLLECT` 啟用，未設即照常首張不符即拋，可常駐包著）。
- 範圍以 `AsyncLocalStorage` 界定（同一行程內並行之案例互不混入），且只在**該次** `run` 執行期間有效：每次 `run` 有自己的序號，`run` 結束後（即使同一收集器已開始下一次 `run`）遺留之非同步工作（未等待之計時器、事件回呼）不再收集，其比對照常立即拋錯；同一收集器之 `run` 不可重疊。**範圍外即使 `E2E_COLLECT=1` 仍照常立即拋錯**——`assertBaselineMatch` 不讀環境變數，避免「記了卻沒人彙整」之假綠。
- `assertBaselineMatch` 之 `opt.collect`：未給＝作用中收集器已啟用才收集；`true`＝用作用中收集器（不論啟用與否）；`false`＝不收集；收集器物件＝收集至該物件（**須已啟用且即目前非同步脈絡之作用中收集器**；範圍外、或自他案例之脈絡傳入，皆照常拋錯）。
- 巢狀：位於啟用之收集範圍內（含中間隔著未啟用收集之比對端，任意層數）呼叫 `runBaselineCase` 產製端即拋錯（互斥）；未啟用收集之比對端遮蔽外層範圍，該案例照常首張不符即拋。
- 測試框架之略過訊號（mocha `this.skip()` 拋出之 `Pending`，以建構函數名辨識）於已收集不符時**不掩蓋**：`run` 內、`onKnownDefect`、`afterCase` 任一處 skip 而已有不符者，改拋彙整錯誤（失敗優先）；無不符者 skip 照常。
- 收集時：不符（超過容差、尺寸不同）照常存三聯組於 `pendingDir`；**缺標準圖記為「缺標準圖」並把 capture 存成 `<標籤>__<時間戳>__capture.png`（候選標準圖；須可解碼，否則照常拋解碼錯誤）**；通過亦記一筆（每一階段之狀態完整，含餘裕告警照印）。`runBaselineCase` 之案例末比對：比對函數（含 `pathOf`、`labelOf`、`compareBuf`）拋出之其他錯誤記為「比對錯誤」並續比其餘各張（標籤取不到時以 `<lang>-<圖鍵>`）；自訂 `match` 正常回傳而未經 `assertBaselineMatch` 記錄者補記通過（以單張比對之標記判定，等待期間同案例他處之紀錄不混淆）；未自訂 `match` 時 `runBaselineCase` 之 `pendingDir` 即證據目錄。
- 證據檔名之 capture 以排他建立保留（跨行程同毫秒同標籤時改用 `-N`，不共用同一組）。

**彙整錯誤之固定格式**（案例正常結束、關瀏覽器與 `afterCase` 之後才拋）：

```
截圖與標準圖不一致 ×<不符張數>/<比對張數> [<案例鍵>]: <標籤>(<狀態>), <標籤>(<狀態>), ...
  - <標籤>: <明細> → <證據檔>
  ...
  (案例清單 <pendingDir>/<案例鍵>__<時間戳>__collect.json)
```

- 狀態為 `<N>px`（真不同像素數）、`尺寸不同`、`缺標準圖`、`比對錯誤`；標籤同證據檔名（只含 `[\w.-]`），案例鍵於 `runBaselineCase` 為 `<lang>-<name>`。解析首行：`/^截圖與標準圖不一致 ×(\d+)\/(\d+) \[([^\]]*)\]: (.*)$/`，項目 `/([\w.-]+)\(([^)]*)\)/g`；未列出之已比對階段即通過。
- 錯誤物件另帶 `baselineCollect: { caseKey, records }`，`records` 含通過者，每筆 `{ label, status:'pass'|'diff'|'size'|'missing'|'error', numDiff, maxDiffPixels, capSize, baseSize, baselinePath, stem, message }`。
- 有不符時另寫案例清單 JSON（`{ caseKey, outcome:'mismatch'|'failed', error, cwd, records }`），**寫入每個有證據之目錄**（各目錄各自嘗試、一個失敗不影響其餘；檔名排他建立），供審查與採用工具辨識所屬案例、結局與正式標準圖路徑；**有「比對錯誤」者 `outcome` 為 `failed`**（該案比對未能完成，其餘證據亦不可採用）。清單或日誌本身寫入失敗不取代原錯誤（記於 `baselineCollect.sideErrors`；彙整時註明「案例清單寫入失敗」）；寫不出清單之目錄內之證據無清單，採用工具即拒收（見下）。

**與其他錯誤、已知缺陷、產製模式**：
- **語意斷言、不變式、操作逾時等其他錯誤照常立即拋出，且以該錯誤為準原樣拋出（同一物件、訊息不變）**；已收集之不符另印一行 `[baseline-collect] 截圖與標準圖不一致 ×n/m [案例鍵]: … (案例另因錯誤失敗, 以該錯誤為準)`、掛於該錯誤之 `baselineCollect`、案例清單 `outcome:'failed'`。`runBaselineCase` 之語意斷言失敗後不做案例末比對（同預設）。**`failed` 案例之截圖不得採用**（可能是壞畫面）；修好後重跑該案。
- 已知缺陷：收集到不符時**不呼叫 `onKnownDefect`**、於收尾（關瀏覽器、`afterCase`）之後拋彙整錯誤（不收集時那一張早已拋錯而非 pending，回歸不被 pending 掩蓋）；收尾另拋錯者以該錯誤為準、清單 `failed`；無不符才照常 `onKnownDefect`。
- 比對錯誤之分流：案例末之比對錯誤（含當次截圖解碼失敗）記錄並續比；`run` 內逐階段直呼 `assertBaselineMatch` 遇解碼失敗等非像素錯誤則同其他錯誤立即中止（`run` 本身已拋出）。
- **與產製模式互斥**：`runBaselineCase` 之產製端遇 `collect`／`E2E_COLLECT=1` 於開瀏覽器前拋錯；`getE2eMode` 於 `--baseline`／`E2E_REGEN=1` 且 `E2E_COLLECT=1` 時拋錯（`guard:false` 可關，僅供測試）。
- strict settle：`captureStable` 之 `strict`（產製端或 `E2E_STRICT_CAPTURE=1`）未 settle 即拋錯——屬截圖失敗而非像素不符，**不被收集**、照常中止；非 strict 時未 settle 回最後一張，比對不符即被收集。
- 遮罩：在截圖時套用（`captureStableWithBox`），收集之 capture 即遮罩後之圖（同預設證據）。
- 比對端覆蓋（`compareBuf` 或自訂 `match` 內之覆蓋）：證據之 capture 為**覆蓋後**之影像；採用時覆蓋區之內容取自舊標準圖（覆蓋區本不參與比對；覆蓋區須為真實內容者改以產製模式產該張）。

**單趟流程**：①記下本趟開始時間 T，`E2E_COLLECT=1` 跑全量比對 → ②`node node_modules/w-package-tools-e2e/tools/reviewPending.mjs --since <T> --crops ./testPending/_review` 分類（SAME／NOISE／CHANGED 附差異外框與並排裁圖／SIZE／MISSING，並列所屬案例與 `failed`）→ ③逐張審差異（全域技能 role-coder-for-test-e2e §7.9 之差異分流：只落在不可固定之值者補遮蔽、不採用）→ ④`--since <T> --accept <標籤,...>` 採用（先 `--dry-run`）→ ⑤只重跑「另因錯誤失敗」之案例；純像素不符而採用者，其通過與否由採用本身決定（capture 即新標準圖），不必整趟重跑。
- `--since`：證據目錄永不自動清除，不給即含前幾趟之殘留——本趟已通過之標籤若有舊證據，會被列為待審甚至被採用，故一律給本趟開始時間。
- 採用前之驗證：所屬案例 `outcome:'failed'` 拒收；同一證據被不同案例或結局之清單引用（清單衝突）拒收；證據過期拒收（正式標準圖已與證據中之副本不同，或缺標準圖之證據而正式圖已出現）；capture 須為可解碼之 PNG；多個標籤指向同一正式標準圖拒收（以檔案身分或真實路徑判定：junction、符號連結、硬連結、大小寫別名皆視為同一）；**無案例清單之證據無法證實其案例結局，預設拒收**——確為非收集模式之舊證據者，API 明給 `legacy:true` 並以 `pathOf` 給路徑（CLI 不提供）；任一標籤不合格即全部不採用。
- 清單紀錄與證據之對應：以紀錄之完整證據路徑（依其 `cwd` 解析）對應本證據目錄，跨目錄同名（同標籤同毫秒）不混淆；證據目錄被整個搬動時退回以檔名主幹對應，候選不一致即標衝突。
- 相對標準圖路徑之根：預設為案例清單所記比對時之工作目錄（自他目錄執行亦寫回原處）；`--root`（API 之 `root`）明給者以之——多開實例之證據要採用回主樹時給主樹根。
- `--crops` 之並排裁圖排他建立（已存在加 `-N`），永不覆蓋任何既有檔。
- 已知限制：①`--since` 以證據檔名之毫秒時間戳含等號比較——T 須於前一趟結束後才取（前後兩趟重疊時，同一毫秒之舊證據仍會列入）；②證據檔名之保留只排他建立 capture，只剩孤立之 `__diff.png`／`__baseline.png`（證據被部分清除）而同標籤同毫秒再失敗時，該檔會被改寫（1.0.10 即如此，為維持預設行為不變未改）。

### 2.9 有變更才改寫（`E2E_BASELINE_KEEP_SAME=1`；Gitea issue #19 第 2 項）

**預設關閉**；未設時產製端一律寫出、不讀標準圖（同 1.0.10）。啟用時 `runBaselineCase` 之每張寫檔經 `writeBaselineIfChanged`（不經 `runBaselineCase` 之專案可直接呼叫），依序判定：

1. 標準圖不存在 → 寫（`missing`）。
2. **暫時狀態圖**且標準圖已存在 → 不改寫（`transient`）。暫時狀態圖＝畫面只停留短暫、截到之影格取決於時序之狀態（提示訊息滑入中、載入中轉圈、進度條），由專案以 `runBaselineCase({ transient: [圖鍵,...] })` 或 `(lang, 圖鍵) => Boolean` 宣告；要刻意重產者以不設 `KEEP_SAME` 之產製模式配 `--names` 產該張。
3. 以 `compareBuf(當次截圖, 標準圖路徑, ctx)`（比對端覆蓋；未給即當次截圖）與標準圖比：尺寸不同 → 寫（`sizeChanged`）；RGBA 逐像素相同 → 保留（`same`）。
4. `E2E_BASELINE_KEEP_MAXDIFF` 為保留之差異上限：未設＝比對端容差（`runBaselineCase` 之 `maxDiffPixels`，預設 100）；`0`＝只保留 RGBA 逐像素相同者（pixelmatch 計數 0 而 RGBA 不同者照寫，原因 `rgbaDiff(diff=0px)`——threshold 0.1 下均勻之小亮度差不計入計數）；`N`＝pixelmatch（`includeAA:false`，threshold 同比對端）真不同像素數 ≤ N 保留（`same(diff=Npx≤N)`），否則寫（`diff=Npx`）。格式非非負整數即於開瀏覽器前拋錯；`KEEP_SAME` 未設時不讀、不驗。
- 寫出者一律為**當次截圖本身**（不是覆蓋後之影像）；判定一律對正式標準圖路徑，寫出落點仍依 `E2E_BASELINE_OUT_DIR`。
- 與 `createBaselineGate` 併用：`--names` 篩選與 `--write-mode all|missing` 先決，決定要寫者再經本判定；**`--write-mode changed` 之容差判定由本判定取代**（同一覆蓋與 `KEEP_MAXDIFF`；否則 gate 之 100px 會先行保留，使 `KEEP_MAXDIFF=0` 失效），日誌原因為 `changed→keepSame; …`；日誌原因合併（`[write] eng-x (all; diff=150px)`）；保留者印 `[keep] … (same)` 並計入 `out.kept`，亦算已產出（`finalize` 不報未命中）。正常路徑與部分已知缺陷之前段共用同一寫檔迴圈；`compareOnly` 不寫（不經此判定）。
- **兩端同一覆蓋與容差**：比對端覆蓋請改給 `runBaselineCase` 之 `compareBuf`（比對端先以之處理再交 `match`，標準圖不存在時不呼叫），判定即自動同一覆蓋；仍寫在自訂 `match` 內者，判定看不到該覆蓋（會多寫）。`maxDiffPixels`／`threshold` 給定時同為預設 `match` 之容差。**配自訂 `match` 時須明給與之相同之 `maxDiffPixels`（或 `keepMaxDiff`／`E2E_BASELINE_KEEP_MAXDIFF`）**，否則於開瀏覽器前拋錯——套件看不到自訂 `match` 之容差，以預設 100 保留之圖可能在比對端仍失敗。
- 未啟用時同步逐張寫出（不 `await`），寫檔與日誌之時序同 1.0.10。
- 比對端不讀 `KEEP_*`。

### 2.10 埠位移（`E2E_PORT_OFFSET`；Gitea issue #19 第 3 項）

**預設 0**（未設、空字串或 `0` 皆原樣，不驗證、不轉型）。實際埠＝基準埠＋位移（非負整數；格式錯誤、結果超過 65535 即拋錯，不靜默沿用基準埠——沿用即會連到他實例之服務）。

**套件內之組埠處**（全數改讀位移）：`createServiceManager` 之探測 url（預設 `http://<host>:<實際埠>/`）、`probe(svc)` 之 `svc.port`、就緒逾時與日誌、`restart` 之 `killListeners(實際埠)`、`spawn({ args, env, port })` 與 `beforeSpawn({ …, port })` 之 `port`、`portOf(name)`。`port` 與 `portOf` 為**不可列舉屬性**（以解構或 `o.port` 取用；`Object.keys`、JSON、展開皆不含），參數物件與管理器回傳物件之鍵集合與鍵序同 1.0.10。字串 url 之協定預設埠（`http` 80、`https` 443，明寫或省略皆同）視為該埠。`probeHttp(url)`、`killPortListeners(port)`、`listenerPids(port)` 收完整網址／埠，**不另位移**（呼叫端以 `resolveE2ePort` 組成，免重複相加）。

**專案端 setup 須如此宣告基準埠才能受益**：

```js
import createServiceManager from 'w-package-tools-e2e/src/createServiceManager.mjs'
import resolveE2ePort from 'w-package-tools-e2e/src/resolveE2ePort.mjs'

let sm = createServiceManager({
    services: [
        //port 寫基準埠; 服務以收到之 port(實際埠)啟動——命令列參數或環境變數, 不可在服務端寫死
        { name: 'backend', port: 11007, spawn: ({ args, env, port }) => spawn('node', ['srv.mjs', '--port', String(port), ...args], { stdio: 'ignore', env, windowsHide: true }) },
        { name: 'frontend', port: 8080, spawn: ({ port }) => spawn('npx', ['vue-cli-service', 'serve', '--port', String(port)], { stdio: 'ignore', shell: true, windowsHide: true }) },
        //自訂探測網址: 給函數 (port)=>網址; 給字串時其埠須等於基準埠(位移時改為實際埠, 不等即拋錯)
        //{ name: 'api', port: 11005, url: (port) => `http://127.0.0.1:${port}/api/ping`, spawn: ... },
    ],
})
let baseUrl = `http://127.0.0.1:${resolveE2ePort(8080)}` //前端網址、後端網址、設定檔內之埠、killPortListeners(resolveE2ePort(11007)) 一律經此
```

- 設定檔（JSON5 等）內寫死之埠：以 `createTempSettings` 之 overrides 寫入 `resolveE2ePort(基準埠)`；前端 dev server 之 proxy 目標同。
- 實例仍須各自一份資料庫、上傳檔與 `test/_tmp/`（多開臨時實例時整樹複製或另指資料目錄），但不必改任何原始碼。
- 位移後之埠須仍 ≥ 8000 且與他專案錯開（全域技能 role-coder-for-test §5）；位移值由多開之調度方指定（例：100、200），或由自動換埠選定（§2.12）。

### 2.11 分組多開（`runShardedE2e`、`tools/shardE2e.mjs`；2026-11-04）

把一個專案之 e2e 檔分組，各組放進臨時實例同時跑，彙整結果後移除實例。**只跑比對，不寫標準圖**（`E2E_REGEN=1`、`mochaArgs` 含 `--baseline` 即拋錯；`test/pics` 為指回正式專案之 junction）。**專案不使用本工具時一切照舊**；未設 `E2E_PORT_OFFSET` 時既有 API 行為不變。

**前提**：專案已依 §2.10 宣告基準埠（否則多於 1 組即拋錯：未接線時各組都用基準埠，依沿用政策互打而不報錯）。

**設定** `test/tools/e2eShard.json`（可不存在，CLI 參數或 `opt` 覆寫同名欄位；未知之鍵即拋錯）：

| 欄位 | 意思 | 預設 |
|---|---|---|
| `ports` | 基準埠陣列，預檢用。**實跑時必給**；專案確實無服務者明寫 `[]` | — |
| `instances` | 實例數 | 5 |
| `officialOnly` | 只能跑在位移 0 之檔名（畫面或期望值含主機、埠者）；含不存在之檔名即拋錯 | `[]` |
| `together` | 必須同組之檔名陣列之陣列；有交集者合併 | `[]` |
| `durations` | 各檔耗時（分），只用於分組；缺者以已知檔之平均值估算 | `{}` |
| `exclude` | 額外不複製之路徑（相對專案根） | `[]` |
| `portStep` | 各組埠位移間距，沒有占用時第 i 組位移＝i×portStep | 100 |
| `portTries` | 每組最多試幾個位移槽；給 1 即只試組序對應之槽，被占用即拋錯 | 20 |
| `portWaitMs` | 含 `officialOnly` 之第 0 組等待基準埠之上限（毫秒） | 1800000 |

```json
{
    "ports": [11006, 8090],
    "instances": 5,
    "officialOnly": ["e2e-apitest.test.mjs"],
    "exclude": ["user_data"],
    "durations": { "e2e-users.test.mjs": 12.5 }
}
```

**CLI**（於專案根）：`node node_modules/w-package-tools-e2e/tools/shardE2e.mjs [選項]`；選項 `--root`、`--config`、`--plan`、`--ports a,b`、`--instances N`、`--official-only a,b`、`--together "a,b;c,d"`、`--durations <JSON>`、`--exclude a,b`、`--port-step N`、`--port-tries N`、`--port-wait-min 分`、`--mem-per-instance GB`、`--work-dir`、`--out-dir`、`--mocha-args "--timeout 300000"`、`--group-timeout-min`、`--progress-min`、`--tree-sample-ms`、`--update-durations`、`--debug`。`--plan` 只印分組與預估，不取鎖、不建立任何東西、不執行。

**流程與保證**：

1. **分組**（`planE2eShards`）：以 `/^e2e-.*\.test\.mjs$/` 列舉，不靠寫死清單；由大到小放入目前最輕之組；`officialOnly` 固定第 0 組；`together` 不拆開；實例數不超過可分開之單元數。
2. **記憶體守門**：依可用記憶體（`os.freemem()`，每實例預設 1.5 GB）調降並印原因；連 1 個都不夠時仍跑 1 個並警告。
3. **鎖**：`<workDir>/shard.lock` 擋第二個同時執行者；持有者 PID 已死、或 PID 存在而起始時間與鎖檔不完全相同（PID 回收）之鎖可接手；鎖檔沒有真實起始時間（舊格式、或當時取不到行程表）而 PID 存在者視為仍在。
4. **清殘留**：接手死鎖時只殺身分已確認之殘留（見下方〈行程身分〉；舊格式鎖檔一律不殺並記警告），再依第 8 點移除上次留下之 `inst<N>`。
5. **配發埠**：每組之每個埠先預約（§2.12，跨行程排他，持有至收尾）再以五種試綁定（`127.0.0.1`、`0.0.0.0`、`::`〔雙棧〕、`::1`、`::`〔`ipv6Only`〕，§2.12）檢查，**不沿用**。沒有占用時第 i 組位移＝i×portStep（同未支援換埠前）；該組之埠被占用或被他人預約時**不殺占用者**，改用下一個空的位移槽（至多 `portTries` 個）並印原因；含 `officialOnly` 之第 0 組畫面含埠，只用位移 0，被占用時等待（至多 `portWaitMs`）。皆未過於建立實例前拋錯並列出占用者（PID 與映像名稱）。
6. **建立實例**：`<專案根>/tmp/e2e-shards/inst<N>/<專案名>`（可改 `workDir`；`workDir`、`outDir` 之相對路徑以專案根解析）。排除 `node_modules`、`.git`、`docs`、`tmp`、`testPending`、`logs`、`sgud`、`test/pics`、`test/_tmp` 與 `exclude`（皆相對專案根）；`node_modules`、`test/pics` 以 junction 指回；來源樹（不含排除項）內另有連結即拋錯列出；實例內建空 `logs`。**`.env` 等只由 OS 複製，工具不讀內容、不印出，隨實例刪除**——`workDir` 請留在 gitignore 範圍內。
7. **執行**：各實例 `E2E_PORT_OFFSET=<配發之位移>`（並帶 `E2E_PORT_HOLD`，組內呼叫 `reserveE2ePorts` 時沿用、不再換埠），`cwd` 為實例根，`node node_modules/mocha/bin/mocha.js --no-parallel <該組檔案> --timeout 180000 --reporter <本套件報告器>`（`mochaArgs` 可調，不可含 `--reporter`、`--parallel`）；隱藏視窗；輸出分寫 `<outDir>/group<i>.log`（執行中直接寫，行程被硬殺仍在）；報告器之輸出同內建 spec，另寫統計 `group<i>.result.json`；每 5 分印一行進度；每組逾 4 小時（`groupTimeoutMs`）終止。
8. **收尾**（成功、失敗、例外、SIGINT、SIGTERM、SIGBREAK、SIGHUP 皆執行）：樹狀終止存活之子行程、下殺身分已確認之孤兒（〈行程身分〉） → 回驗本次各埠已釋放 → 各實例 `testPending` 搬回正式專案（不覆蓋，撞名加 `-N`）→ 以不跟進連結之方式列出連結、逐一拆除、回驗清單為空且目標完好 → 遞迴刪除並確認已不存在。任一步失敗大聲報錯、不繼續刪除該實例、離開碼非 0。**Windows 之 `taskkill /F`、`child.kill()` 為 TerminateProcess，處理器來不及執行，由下次開跑清除**；真實訊號只有主控台事件。
9. **彙整**：逐組印耗時、通過、失敗、pending 與檔案；最後印 mocha 同格式之 `N passing`、`M failing`、`P pending` 與失敗案例標題。有失敗、未跑完、某組沒有統計、0 案例、mocha 離開碼與統計不符或收尾失敗，`exitCode` 即非 0；收到訊號為 128＋訊號值。回傳值含各組結果與實際耗時。另印可貼回之 `durations`；`--update-durations` 才寫回，預設不改檔。

**行程身分**（不變式：**未經正面確認身分之行程一律不殺**；取樣、收尾、鎖檔殘留清除、仍占埠之監聽者皆同）。Windows 之 PID 會回收（本機實測連起 2516～21080 個短命行程即回收，10～97 秒），已結束之父 PID 仍留在子行程之 `ParentProcessId`，故「父已結束＋ppid 相同＋起始較晚」、「監聽本次埠＋起始晚於開跑」都不足以下殺。可下殺者與紀錄之 `basis`：

| `basis` | 判定 | 為何可信 |
|---|---|---|
| `own-child-handle` | 根：持有之 `child` 尚未 exit，走 `killOwnTree`（`taskkill /F /T`） | 未 exit 前 PID 不會被回收 |
| `identity` | PID 與起始時間皆與存活時之紀錄**完全相同**（容差 0；`CreationDate` 同一行程每次相同） | 同一行程；紀錄只來自行程表，不用 `Date.now()` |
| `chain:<父PID>` | 由身分已確認之存活行程，沿存活父子鏈走到，且起始不早於其父 | 父自起始至今持續持有該 PID，此期間建立且 ppid 為該 PID 者必為其子 |

本行程與其祖先鏈永不下殺，也不經其往下走。取不到行程表一律不殺並記警告。除根以外之下殺不帶 `/T`（子孫已自行走訪、逐筆留紀錄）；Windows 先取 handle 釘住行程、在同一 handle 上比對起始時間才終止，比對與下殺之間 PID 不可能被回收。**不讀其他行程之環境區塊與工作目錄**（可能碰到憑證，又依賴未公開之 PEB 配置），也不取命令列。身分靠取樣：開跑後立即取樣一次，之後每 `treeSampleMs`（預設 10 秒，單次約 0.5 秒）沿存活父子鏈記下子孫。

**紀錄**：每次下殺印一列 `[shard] 下殺 PID <pid> <映像名> 起始 <ISO> 依據 <basis> 階段 <phase> 結果 <result>`，並寫入回傳值與 `summary.json` 之 `kills`（`{pid,image,startMs,start,basis,phase,result}`；`phase` 為 `stop`、`teardown`、`teardown-port`、`stale-lock`；`result` 為 `killed`、`pending`、`gone`、`mismatch`、`error`、`exec-failed`、`tree-kill-requested`）；未下殺者入 `killSkipped`（`reason`：`no-evidence`、`protected`，占埠者帶 `port`；其中多為他人之行程）；`knownCount` 為 `{current,total}`。開跑前之例外若已有下殺，例外帶 `err.kills`，並寫入 `outDir` 之 `summary.json`。

**代價**：未曾被取樣之孤兒（服務起來後、下一次取樣前，其父鏈就斷了）殺不到——占埠者收尾大聲報錯（埠未釋放，列出占用者）、該實例保留、離開碼非 0，手動停掉後重跑工具清除；不占埠也不鎖實例者留在機器上，只有 `killSkipped` 有紀錄。POSIX 路徑只有注入測試，未實機跑過。

**不得多開之流程**（SKILL §1.5）：畫面或期望值含主機與埠者列 `officialOnly`；共用同一真實收件匣者不要在兩個實例同時跑（放在同一組）；未通過首次等價驗證之專案不得以實例結果當標準圖依據（本工具本來就不寫標準圖）。

**切勿**直接遞迴刪除或以 robocopy 鏡像清除 `workDir`：實例內尚有 junction 時會穿過連結刪到正式專案；工具留下之殘留一律重跑工具清除。

### 2.12 自動換埠（`reserveE2ePorts`；2026-11-05）

單開 e2e 被占用時自動換埠，使不同套件可同時跑。**沒有占用時即基準埠，位移環境變數維持未設，埠、行為與標準圖皆與未導入相同。** 不是第二套解析：只把選定之位移寫入 `E2E_PORT_OFFSET`，`resolveE2ePort`、`createServiceManager`、前端 proxy 與子行程照舊由它取得實際埠（§2.10）。

**導入**（`test/tools/e2e-setup.mjs` 最上層，在任何 `resolveE2ePort`、`createServiceManager` 之前；一次宣告本實例全部基準埠）：

```js
import reserveE2ePorts from 'w-package-tools-e2e/src/reserveE2ePorts.mjs'
import resolveE2ePort from 'w-package-tools-e2e/src/resolveE2ePort.mjs'

reserveE2ePorts([11007, 8080]) //被占用時印 [e2e-port] 基準埠 [11007, 8080] → 實際埠 [11107, 8180](位移 100), 並列出占用者
let baseUrl = `http://127.0.0.1:${resolveE2ePort(8080)}`
```

**選定流程**：位移 0、`portStep`、2×`portStep`…逐一試（至多 `maxTries`，預設 20）：①預約該位移之每個埠（登錄目錄內每埠一檔，排他建立，由小到大取）→ ②實際綁定驗證（五種試綁定：`127.0.0.1`、`0.0.0.0`、`::`〔雙棧〕、`::1`、`::`〔`ipv6Only`〕）→ 全部通過才採用，預約持有至行程結束；任一埠被占用或被他人預約即撤回已取得者、換下一個位移。用盡即拋錯（`err.code` 為 `E2E_PORT_EXHAUSTED`，訊息與 `err.blocked` 列出每個埠之占用者）。`opt.avoid` 列專案其他測試寫死之埠（如 `api-` 測試之固定埠），落在其上之位移直接跳過、不計次數。

**試綁定之判讀**（Windows 11 實測，真實行程）：每種占用形式只和**同一形式**之試綁定衝突（占用者綁 `::` 時只有 `::` 失敗，其餘可綁；Node 之 `listen(port)` 未指定位址即綁雙棧 `::`）；雙棧 `::` 與 `ipv6Only` 之 `::`（`listen({ port, host: '::', ipv6Only: true })`）是**兩種形式，互不衝突**（2026-11-05 pe316 實測：占用者各綁一種，五種試綁定中恰好只有同形式者 `EADDRINUSE`，其餘四種可綁，另一形式亦然），故須**五種**都試：`127.0.0.1`、`0.0.0.0`、`::`（雙棧）、`::1`、`::`（`ipv6Only`）。因此「某一種失敗而其餘可綁」代表確有 socket 占著該形式，不是假占用；`ipv6Only` 之 `::` 失敗時 `err.blocked` 與訊息之位址記為 `::(ipv6Only)`。僅綁定未 `listen` 之 socket 同樣衝突，但查不到監聽者（訊息為「查無監聽者」）。**連線殘留 TIME_WAIT 不影響綁定**：服務結束後留下 1500 條 TIME_WAIT（服務綁 `127.0.0.1`、`::`，客端 IPv4、IPv6）各種位址皆立即可綁，不需等待。本機無 IPv6（`EAFNOSUPPORT`、`EADDRNOTAVAIL`）者，`::`、`::1`、`ipv6Only` 之 `::` 三種不算占用。**殺殘留後等待釋放時偵測失敗**（偵測子行程回傳 `null`）視為**仍忙**，不當成全部可用：保留最後一次成功偵測之結果，等滿 5 秒仍失敗即換下一個位移，訊息寫明「偵測子行程失敗」（`err.blocked` 之 `code` 為 `PROBE_FAILED`）。每個位移之第一次偵測即失敗（殺殘留前，或沒有殘留可殺；如偵測工具壞掉）則照舊警告後照預約結果繼續。

**競爭**：同時開跑者以預約檔排他，不會選到同一組；被預約之埠不做實際綁定（不干擾持有者）。**預約殘留**：持有者已死（PID 不存在，或 PID 存在而起始時間差逾 60 秒＝PID 回收；行程表取不到時視為仍在）即回收；不可讀之預約檔 60 秒內視為仍在。正常結束與 `process.exit` 時自動釋放；`taskkill /F` 者由下次開跑回收。

**占用者一律不殺**（E4）。唯一例外：同一專案（`root` 相同，預設 `process.cwd()`）之殘留預約記有已確認身分之行程時，只依 `identity`、`chain` 下殺這些行程（階段 `stale-reservation`，每筆印 `[e2e-port] 下殺…`），之後回到基準埠。身分由 `createServiceManager` 於服務就緒後背景取樣（`noteOwn`；未用管理器者自行呼叫 `reservation.noteOwn(child)`），寫入預約檔；未曾被取樣者不殺。

**與 `E2E_PORT_OFFSET`、多開之關係**：

| 情形 | 行為 | 回傳之 `source` |
|---|---|---|
| 未設 | 自動選定，寫入 `E2E_PORT_HOLD` 與（位移非 0 時）`E2E_PORT_OFFSET` | `auto` |
| 已設（手動；含 `E2E_PORT_OFFSET=0`） | **不換埠**，只預約與告警；`0` 即明確要求基準埠與沿用政策之逃生口（開發中之服務沿用即用此） | `pinned` |
| 上層已保留（`E2E_PORT_HOLD`；逐檔 runner 之子行程、`runShardedE2e` 之各組） | 沿用上層之位移，不偵測、不預約 | `inherited` |

多開由工具指定位移，工具配發時走同一套預約（§2.11 第 5 點），故單開選不到多開之埠，多開也避開單開已保留之埠；多開未持有之 `ports` 外之埠不受此保護（§2.11〈ports 須列全〉）。

**綁定被搶走**（偵測與綁定之間被未導入者占走）：`createServiceManager` 發現保留後埠已有回應且尚未啟動過，拋錯寫明占用者，**不沿用、不下殺**（重跑即重選）；spawn 之後才被占走者由就緒核對擋下（§2.4）；服務於就緒前結束立即拋錯，不等到逾時。

**vue-cli 靜默改埠**：`vue-cli-service serve --port N` 之 `--port` 只是 portfinder 之起點，埠被占走會靜默改用下一個，不報錯；帶 `--port` 擋不住，修前管理器還會把占用者之回應當成已就緒。現由就緒核對擋下（`E2E_PORT_NOT_OWN`），使用端不必再自行以輸出核對實際埠。

**行程內自行監聽者**（靜態站、假伺服器）：**優先 `listen(0)`**，由作業系統配發，不必保留也不會撞；只有埠不能任意（畫面或設定含埠、對外約定之埠）才用 `applyEnv:false` 取獨立保留，綁定遇 `EADDRINUSE` 呼叫 `reselect()` 換下一個位移：

```js
let r = reserveE2ePorts([8136], { applyEnv: false })
while (true) {
    try {
        await listen(r.portOf(8136))
        break
    }
    catch (err) {
        if (err.code !== 'EADDRINUSE') throw err
        r.reselect('EADDRINUSE') //次數與選定共用上限, 用盡即拋錯(訊息與 err.trigger 含觸發本次重選之埠與占用者, 不必自行補)
    }
}
```

`applyEnv:true`（預設）之位移已被常數取用後不可重選（常數已過期）；管理器因此不自動重選。

**已導入時 `createServiceManager` 之差異**：①保留後被占用不沿用；②`restart` 要殺非自建之監聽者時（`killForeignOnRestart`），改走 `reservation.killOwnListeners(port)`，只殺身分已確認屬本實例者，其餘拋錯寫明占用者；③服務就緒前結束即拋錯；④就緒逾時之訊息寫明該埠之占用者（非 HTTP 之占用者使探測一直不通時查得到是誰）。就緒核對與 `restart` 查不到即拋錯不分是否導入（§2.4）。

**畫面含埠之流程**（規格 E7；全綠不能證明畫面不含埠：差異可能低於容差，實測見 `test/e2e-portInImage.test.mjs` `[PI1]`）。使用端依下表擇一：

| 作法 | 怎麼做 | 何時選 |
|---|---|---|
| **比對端覆蓋**（首選） | `runBaselineCase` 之 `compareBuf` 以 `overlayRegions` 把含埠之矩形換成標準圖同座標內容（與截圖同一畫面狀態下量，涵蓋到行尾），被覆蓋之值另以語意斷言驗為實際埠；標準圖不動 | 含埠之處是畫面一小段、位置固定，且該流程要能併行 |
| **只能在基準埠跑** | `reserveE2ePorts(ports, { baseOnly: true })`：被占用時**等待**（至多 `waitTimeoutMs`，預設 30 分）不換埠，逾時拋 `E2E_PORT_BASE_BUSY`；多開時列 `officialOnly`；流程開頭 `assertE2eBasePort('流程名')` 防止跑到位移實例 | 含埠之處多或散、難以量測，或期望值含埠而不便改；代價是同機同基準埠者要排隊 |

```js
//比對端覆蓋
await runBaselineCase({
    //…
    compareBuf: async (buf, baselinePath) => {
        let box = await page.locator('#url').boundingBox()
        return overlayRegions(buf, [{ x: box.x - 3, y: box.y - 3, w: box.width + 40, h: box.height + 6 }], fs.readFileSync(baselinePath))
    },
})
assert.strictEqual(await page.textContent('#url'), `http://127.0.0.1:${resolveE2ePort(8080)}/?view=user`) //被覆蓋之值另以語意斷言驗
```

**各套件要改哪裡**：

1. `test/tools/e2e-setup.mjs` 最上層呼叫 `reserveE2ePorts(本實例全部基準埠)`；`opt.avoid` 列同套件 `api-`、`unit-` 測試寫死之埠。
2. 前端、後端、redirect、CORS、種子內網址、設定檔之埠一律由 `resolveE2ePort` 衍生；`Grep "localhost:|127\.0\.0\.1:" test/` 逐筆確認（§2.10）。`vue-cli-service serve` 要帶 `--port <實際埠>`（只是起點，被占走時之靜默改埠由就緒核對擋下，§2.4）。
3. 逐檔 runner（`run-e2e-isolated.mjs`）於最上層先呼叫一次，子行程之 mocha 繼承保留；其 `killPortListeners(埠)` 改為 `reservation.killOwnListeners(埠)`（回傳形狀相容 `{pids,killed}`，多 `skipped`）。
4. 不用 `createServiceManager` 者：自建之服務就緒後呼叫 `reservation.noteOwn(child)`；被占用即拋錯之檢查可移除。
5. 畫面含埠者依上表處理；`test/tools/e2eShard.json` 之 `officialOnly` 改為覆蓋者可移出。
6. 實測（規格 §3）：①人為占用基準埠，e2e 全綠且占用者無恙；②兩個套件同時跑全綠；③沒有占用時，標準圖比對結果與導入前相同。

**限制**：只防已導入者之間互撞與偵測當下之占用者；未導入者（含非 e2e 測試寫死之埠）在保留之後才綁定者，由管理器大聲報錯（§2.4 就緒核對），不自動處理（規格 E8 另案）。登錄目錄在使用者家目錄（不是暫存目錄：`TEMP` 可能因工作階段不同而不同，就看不到彼此之預約）；持有者 PID 判定只用於回收預約，不用於下殺。同一行程內多個管理器管同一埠時，第二個會把第一個啟動之服務當成他人（一個實例一個管理器）。POSIX 只有注入測試。

## 3. 採用步驟（以 w-web-sso 為例）

1. **單一橋接檔**（`test/tools/e2eLib.mjs`）轉出本套件模組；共用層與測試檔一律自橋接檔 import，套件路徑只寫在這一檔（原經 w-web-sso 之 `srcPack/` 橋接者，只需把前綴改為 `'w-package-tools-e2e/src/'`；切換時只升本套件、不連帶升 playwright，Chromium 改版可能使標準圖全面變動，見 §5）：

```js
export { default as createServiceManager } from 'w-package-tools-e2e/src/createServiceManager.mjs'
export { default as registerCleanupHooks } from 'w-package-tools-e2e/src/registerCleanupHooks.mjs'
export { default as captureStable } from 'w-package-tools-e2e/src/captureStable.mjs'
export { default as captureStableWithBox } from 'w-package-tools-e2e/src/captureStableWithBox.mjs'
export { default as inkRect, INK_PAD } from 'w-package-tools-e2e/src/inkRect.mjs'
//...其餘模組同形
```

2. **共用層**（`test/tools/e2e-setup.mjs`）改為組裝橋接檔轉出之模組，**匯出名稱與簽章不變**（測試檔不必改 import）：

```js
import { createServiceManager, registerCleanupHooks, captureStable as pkgCaptureStable, captureStableWithBox as pkgCaptureStableWithBox, waitColResizeOverlay, waitDrawerReady } from './e2eLib.mjs'

let sm = createServiceManager({
    services: [
        { name: 'backend', port: 11007, readyTimeoutMs: 30000, spawn: ({ args, env }) => spawn('node', ['srv.mjs', ...args], { stdio: 'ignore', env }) },
        { name: 'frontend', port: 8080, readyTimeoutMs: 90000, startNote: 'first compile ~15-30s', spawn: () => spawn('npm', ['run', 'serve'], { stdio: 'ignore', shell: true }) },
    ],
    killForeignOnRestart: true, //11007 專屬本專案, CLAUDE.md 明文例外
    onCleanup: () => cleanupTempSettings(),
})
let startServersOnce = () => sm.startServersOnce()
let restartBackend = (pathSettings = './settings.json', envOverride = null) => sm.restart('backend', { args: [pathSettings], env: envOverride })
let cleanup = () => sm.cleanup()
registerCleanupHooks(cleanup, { afterTimeoutMs: 20000 }) //模組頂層: root after 排在 api-setup 強制退出之前

let captureStable = (page, opts = {}) => pkgCaptureStable(page, { settle: [waitColResizeOverlay, waitDrawerReady], ...opts })
let captureStableWithBox = (page, target, opts = {}) => pkgCaptureStableWithBox(page, target, { ...opts, capture: captureStable })
```

3. **測試檔**（以 tokens 為例）：宣告 `cases`（含 `stages`）→ 產製端 `createBaselineGate` ＋ 逐語系逐案 `runBaselineCase({ mode:'regen', gate, ... })` → `gate.finalize()` → `cleanup()`；比對端每個 `it` 呼叫 `runBaselineCase({ mode:'compare', ... })`，兩端共用同一組 `prepare / beforeRun / run / semantic / verify / afterCase`。
4. **runner**：`runIsolatedE2e({ projRoot, testDir, beforeEachFile: 殺專屬後端 port＋等待, afterAll })`。

## 4. 等價驗證協定（專案遷移時證明「零標準圖變動」）

1. 遷移前 `snapshotBaselines('./test/pics')` 存檔；
2. 以**現行碼**產到暫存目錄（`E2E_BASELINE_OUT_DIR=./test/_tmp/eqv-0`）→ `compareImageDirs` 對標準圖目錄，得現況之重現度（對照組）；
3. 只換原語（管線未改）再產一次（eqv-1）；換管線後再產一次（eqv-2）；各與標準圖及前一段比對，差異可歸因到哪一步；判準「`equivalent`」（RGBA 全等，或相異像素全在登錄漂移點內——漂移點須附成因與證據登錄於專案帳本，例：2026-09-22 之後 eng 後台頁首 (60,47) 單點、通道差 ≤ 9），否則逐張說明；**不以 pixelmatch 計數 0 為等價**；另逐張看 `numDiff`，計數逾上限一半者即使通過亦須處置（2026-09-28 實測兩張恰為 100＝零餘裕）；`onlyInB` 去掉 `_` 開頭者須為 0（孤兒）；
4. 以 `--write-mode changed` 實跑一次，須零寫出；
5. mocha 全跑＋`--grep` 單跑；逐檔 runner 全跑；
6. 結束後 `diffBaselineSnapshots` 須 unchanged（added / removed / changed / touched 皆空）且 `git status --porcelain -- test/pics` 為空。

## 5. 改版須知：哪些變更會動到使用端之標準圖

### 行為變更（2026-11-09，pixelmatch 8 之比對度量；使用端既有標準圖之比對結果可能改變）

**會動到比對結果**（不動標準圖像素本身）。本套件之比對依賴由 `pixelmatch ^7.2.0` 升為 `^8.0.0`；介面（函數名、參數、回傳）不變，新增 `pixelmatchOpt` 匯出。

- **度量改變，無選項可還原**：7.x 以 YIQ 平方距離判定（`> 35215·threshold²`，灰階〔三通道同差〕恆約差 27 級即判為差異）；8 起以 OKLab 之 toe 校正明度 Lr 與色度 a、b 計 HyAB 距離（`|ΔLr| + √(Δa²+Δb²)`），距離大於 `threshold` 即判為差異。同一 `threshold: 0.1` 下，不透明灰階之臨界為 23～29 級（近黑較敏感：黑對 24 級灰判為差異；近白較寬：白對 227 判為相同）；色度差亦不同（`#ff0000` 對 `#ff2020` 7.x 判為差異、8 判為相同）。灰階全表（65536 對）8@0.1 與 7.2.0@0.1 判定一致 98.96%。反鋸齒偵測之邏輯於不透明圖兩版相同。
- **半透明像素**：`checkerboard`（半透明像素混色之背景）7.2.0 即有且預設 true，但圖樣不同（7.2.0 以位元組偏移取模，紅通道背景恆為 48；8 以像素索引之雜湊），兩版對半透明像素之判定僅約 83～88% 一致；`checkerboard:false`（疊白底）不是 7.2.0 之預設，亦不能還原。
- **所選參數**（集中於 `src/pixelmatchOpt.mjs`，各比對處一律展開，下游自行呼叫 pixelmatch 者沿用同值）：`threshold: 0.1`、`includeAA: false`、`checkerboard: true`。維持 0.1 之理由（量測：330 張真實標準圖之取樣 110 張＋17 種擾動；真實 Chromium 跨版本渲染差異對；灰階全表）：①雜訊類擾動（亮度 ±8／±16、單點雜訊 ±12／±20、模糊 σ0.5）皆通過，與 7.x 相同，0.08 以下即開始誤報；②真實跨版本渲染差異對之計數與 7.2.0 相同或相近（比值 0.77～1.18）；③文字、色塊、邊框、陰影、1px 平移、亮度 ±40 之真實改變皆被抓到，與 7.x 相同，0.16 以上開始漏掉亮度 ±40；④灰階判定與 7.2.0@0.1 之一致率於 0.1 最高。不放大 `threshold` 或 `maxDiffPixels` 以吸收差異。
- **8 比 7.x 更敏感之處**（屬度量本身，非參數所致）：近黑區之 16～31 級明度差（整張亮度 +24 時深色區被計入，7.x 為 0）、飽和色之 16～31 級色偏（2000 個單點各自隨機色偏 ±28 時，7.x 平均計 1.0 像素、8@0.1 平均計 91.3 像素）。**已知限制**：疊在有色塊上之半透明遮罩 alpha 改變（.3→.45）7.2.0 與 8@true 皆偵測不到，僅 `checkerboard:false` 可；低對比之主色微調（#1976d2→#1e88e5 等，每通道差 ≤ 約 19 級）兩版皆偵測不到。
- **使用端既有標準圖之處置**：升版後比對失敗者，不得以放寬 `maxDiffPixels`／`threshold`、整批重產吸收。逐張判定「是否只因度量而失敗」：以 7.2.0 與 8.0.0 對**同一對**（標準圖、當次截圖）各算一次差異像素數（`npm i --no-save pixelmatch7@npm:pixelmatch@7.2.0` 暫裝舊版對照、不寫入 package.json，兩者以同一組選項 `{ threshold: 0.1, includeAA: false }` 呼叫，8 另加 `checkerboard: true`）；7.2.0 之計數 ≤ `maxDiffPixels` 而 8 之計數 > `maxDiffPixels`，且差異圖（`testPending` 三聯組之 `diff`）顯示差異落在近黑區明度、飽和色色偏、半透明邊緣等 8 較敏感之處、**目視確認畫面內容確實未改變**者，才屬「只因度量而失敗」，只重產這些張（定點重產，逐張列入回報）；兩版計數皆 > 容差者依一般流程查成因（真實改變、不穩定、不可固定之值）；兩版皆通過者無須處理。全量執行之使用端以收集模式（`E2E_COLLECT=1`）取得全部不符證據後依上述逐張判定，再 `reviewPending.mjs --accept` 採用。
- **守門**：`unit-compareMetric` 固定 8 之判定與所選參數——回到 7.x 之判定、改 `threshold` 預設、拿掉 `checkerboard`、改 `includeAA`、或任一 `pixelmatch(` 呼叫不展開 `pixelmatchOpt` 皆會失敗（變異驗證 8 個變異體全數擊殺）。

### 行為變更（2026-11-05，試綁定增第 5 種；殺殘留後偵測失敗不當成可用）

不影響標準圖像素；**沒有占用時埠與行為不變**，只在占用或偵測失敗時才走到：

- **`checkPortFree` 增第 5 種試綁定 `{ host: '::', ipv6Only: true }`**（§2.12）：`ipv6Only` 之 `::` 占用者原本四種皆偵測不到，不會換埠，服務與之並存時就緒核對拋 `E2E_PORT_NOT_OWN` 而重跑仍選同一埠；現在被占用就換埠（`reserveE2ePorts`、`runShardedE2e` 皆然），訊息之位址記為 `::(ipv6Only)`。前四種之選項與順序不變。直接使用 `checkPortFree` 的回傳值者：不可用時 `host` 可能為 `'::(ipv6Only)'`（原只有四個位址字串）。
- **殺殘留後等待釋放時偵測失敗（`null`）視為仍忙**（原被當成全部可用而取得該埠）：等滿 5 秒仍失敗即換下一個位移，`err.blocked` 之 `code` 為 `PROBE_FAILED`，訊息寫明偵測子行程失敗。只在同專案殘留預約被回收、殺殘留行程後、偵測子行程又失敗時才遇到。

### 行為變更（2026-11-05，就緒核對監聽者身分；`restart` 查不到不續行）

不影響標準圖像素；沒有占用時埠與行為不變。**使用端之正常服務不必改**（`shell:true`、`npm run serve` 皆可判定）；收嚴之處（本套件不做舊版相容）：

- **`createServiceManager` 就緒後核對監聽者身分**（§2.4）：探測通過而監聽者不是自建行程或其存活子孫即拋 `E2E_PORT_NOT_OWN`，查不到拋 `E2E_PORT_OWNER_UNKNOWN`。不分是否導入 `reserveE2ePorts`。**會受影響者**：launcher 先結束、服務由孫行程接手者（改為直接 spawn，或給 `opt.verifyOwner`）；單元測試以假 child（`{ pid: 1 }`）與假 probe 使用管理器者（給 `verifyOwner: async () => {}`）。
- **`restart` 查不到監聽者即拋錯**（原為只記錄就續行）；無論是否導入。
- **`reselect` 用盡**：訊息多一段觸發本次重選之埠與占用者，`err.trigger` 為 `[{ port, owners }]`；行程內監聽者自行補占用者之程式可移除。
- **`killOwnListeners` 回傳多 `tableOk`**：`false` 表示身分未知（監聽者或行程表查不到），此時 `skipped` 不代表他人占用。
- **`describePortOwners`「查無監聽者」改字**：寫明可能為僅綁定未監聽之 socket 或保留埠；比對該字串者須調整。
- **查埠逾時 5 秒改 60 秒**（`PORT_QUERY_TIMEOUT_MS`；`describePortOwners`、`killOwnListeners`、`runShardedE2e` 收尾；`listProcessTable` 由 30 秒改同值）：只影響查詢真的失敗時多久才回報。
- **`listProcessTable` 改走作業系統 API**（`NtQuerySystemInformation`，不編譯 C#，無暫存檔；輸出欄位與語意不變；不可用或自我核對不符時退回 `Get-CimInstance`）：實測與舊法 PID、父 PID、起始時間（毫秒）、映像名逐筆相同；約 300 行程時無負載 0.33 秒對 0.43 秒、CPU 2 倍超載 5.5 秒對 33 秒。下殺之身分判準不變。

### 行為變更（2026-11-05，自動換埠；拿掉讀其他行程環境區塊之證據）

不影響標準圖像素；沒有占用時埠與行為不變。新增 `reserveE2ePorts`（opt-in，§2.12），未呼叫者行為不變。

- **`runShardedE2e` 之埠被占用時**：原為預檢失敗即拋錯，現改用下一個空的位移槽（至多 `portTries`）並持有預約；要維持舊行為給 `portTries: 1`。含 `officialOnly` 之第 0 組改為等待基準埠（至多 `portWaitMs`）。回傳值之 `groups[].offset` 為實際位移。沒有占用時第 i 組仍為 i×portStep。
- **移除 `env-marker`、`instance-cwd` 兩種下殺依據**：`readProcessEvidence` 匯出、`reapShardProcesses` 之 `marker`／`dirs`／`procRoot` 選項、`killSkipped` 之 `evidence-unreadable`、環境變數 `E2E_SHARD_RUN`、鎖檔之 `runId` 一併移除（舊鎖檔之 `runId` 忽略；`known` 照用）。下殺依據只留 `identity`、`chain:<父PID>`、`own-child-handle`。未曾被取樣之孤兒不再殺得到：占埠者收尾大聲報錯、實例保留、離開碼非 0（§2.11〈代價〉）。
- **`treeSampleMs` 預設由 30 秒改 10 秒**，以縮短未被取樣之窗口。
- **模組搬移**：`listProcessTable`、`sampleShardKnown`、`findProcessDescendants`、`reapShardProcesses` 移至 `src/reapShardProcesses.mjs`，`src/runShardedE2e.mjs` 照舊轉出；埠之綁定檢查移至 `src/checkPortFree.mjs`。入口多 `reserveE2ePorts`、`assertE2eBasePort`、`checkPortFree`、`reapShardProcesses`。

### 行為變更（2026-11-04，分組多開之下殺須正面確認身分）

不影響標準圖像素與分組、埠位移、實例、彙整；變更只在 `runShardedE2e` 之行程清理（§2.11〈行程身分〉）：

- **`findProcessDescendants` 語意收緊**：已結束之根不再往下走（原依 `ppid` 找子孫）；根之起始時間須完全相同（原容許 60 秒），`opt.slackMs` 移除、新增 `opt.protect`；子孫之起始不得早於其父（原容許 2 秒）。回傳形狀不變。
- **鎖檔格式改變**：`groups`、`procStartMs` 改為 `known`、`procCreateMs`（行程表之真實起始時間），另增 `runId`。舊格式鎖檔不做相容：持有者 PID 已死時可接手，但其紀錄**一律不下殺**並記警告；PID 存在則視為仍在（確認該行程不是工具後刪除鎖檔再跑，或待該 PID 結束）。
- **孤兒之清理範圍**：以環境變數標記與實例目錄確認身分，取代「監聽本次埠＋起始晚於開跑」；未占埠之未取樣孤兒現在也清得到，但環境變數與工作目錄皆無證據者不再清除（見〈代價〉）。
- **回傳值與 `summary.json` 多 `kills`、`killSkipped`、`knownCount`**；`opt.exec` 為新增之測試注入點；`src/runShardedE2e.mjs` 新增具名匯出 `listProcessTable`、`sampleShardKnown`、`readProcessEvidence`、`reapShardProcesses`（未列入 `WPackageToolsE2e` 入口）。

### 行為變更（2026-11-01，Gitea #35：`waitDrawerReady` 只認 WDrawer 根節點）

不影響標準圖像素與既有 API 形狀（簽名、預設逾時 10000ms、逾時不拋錯皆不變）；變更在**認哪些元素**：

- 原以裸 `[state]` 取全部帶 `state` 之元素再篩 `hidden|opening|opened|hiding`；w-component-vue 2.5.35 起 WDialog、WTooltip／WPopup／WTextSelect 之浮層（`.WPopperFix`）亦帶 `state`（WListExpandItem、WGroupTags、WGroupDragdrop 之值域不重疊，不受影響），開啟中之彈窗或提示框會被誤當抽屜而等待。現改以 `[state][changedrawerwidth]` 只認 WDrawer 根節點（依據：2.5.35 實際渲染之 DOM，其他元件之根節點皆無該屬性；詳見 `src/waitDrawerReady.mjs` JSDoc）。
- **使用端影響**：①用 w-component-vue 之 WDrawer 者無須改動；②`captureStable` 之 `settle: [waitDrawerReady]` 不再順帶等待 WDialog、浮層過場落定——截圖仍受連拍穩定兜底；要等者另寫等待或以 `opt.selector` 傳入；③不用 w-component-vue 之 WDrawer、自家元件以裸 `state` 屬性表示過場者，須傳 `{ selector: '[state]' }`（或其元素之選擇器）才會被等待，否則視為「無抽屜」立即放行；④新增選項 `opt.selector`、`opt.debug`、`opt.funLog`；`opt` 之非預期輸入依 dspec〈輸入參數之檢測機制〉K3 視為未給、改用預設而**不拋錯**（`selector` 非字串、空白字串或無法解析之選擇器 → 預設選擇器；`timeout` 非大於 0 且不超過 2147483647 之有效數字〔數字或數字字串，轉換後使用〕→ 10000；`opt` 為 `null` 或非一般物件 → 整份視為 `{}`），`opt.debug:true` 時才以 `opt.funLog`（未給則 `console.warn`）說明哪個鍵因何改用預設；逾時不拋錯之語意不變。**與 pte35 版之差異（實測，修前版本跑新測試）**：`timeout` 給數字字串（如 `'700'`）舊版等了 Playwright 預設之 30000ms（實測 30009ms）、給 `0` 永不逾時（實測卡死）、給 `-1` 於 1.2 秒內即放行，現一律改用預設 10000 或轉換後使用；`opt=null` 舊版拋 TypeError，現視為 `{}`；`selector` 非預期者舊版（pte35 完成時）拋錯，現改用預設。
- `changedrawerwidth` 屬元件內部屬性（WDrawer.vue 之 `:changeDrawerWidth` 綁定，2022-04 起），元件改版或改寫時預設選擇器會選不到抽屜（視為無 WDrawer 而放行，靜默）；升級 w-component-vue 後以 `node test/tools/probeWDrawerDom.mjs <w-component-vue 根目錄>` 複驗（預設選擇器須只命中 1 個 `w-drawer`，否則離開碼 1）。

### Breaking changes（2026-10-30，查埠之監聽者改委由 wsemi 1.9.32）

不影響標準圖像素；破壞性在 `listenerPids`／`killPortListeners`／`parseListenerPids` 之介面（本套件不做舊版相容）：

- **`opt.exec` 形狀改變**：原為 execSync 形 `(指令字串, 選項) => stdout`（以字串比對 `'netstat -ano'`、`'taskkill /F /T /PID …'` 分派）；現為 **spawnSync 形** `(prog, args, { src, timeout, maxBuffer }) => { status, stdout, error }`，以 `src` 分派固定輸出（`listenerPids`：`'netstat'`／`'powershell'`／`'lsof'`；`killPortListeners` 之 `exec` **查詢與下殺共用**，另有 `'taskkill'`（Windows）、`'kill'`（其他平台，經 `sh -c 'kill -9 "$1"'`））。注入之函數拋錯、回傳非物件、`status` 非 0 或帶 `error` 皆視為該子指令失敗。替身寫法範例見 `test/tools/portPidsFake.mjs`、`test/unit-procPrimitives.test.mjs`；使用端既有的 execSync 形替身（如 w-web-task `test/unit-harnessProc.test.mjs`）須改寫。`killOwnTree` 之 `opt.exec` **未改**（仍為 execSync 形：`(指令字串, 選項) => stdout`）。
- **移除 `parseListenerPids`**（模組 `src/parseListenerPids.mjs`、`WPackageToolsE2e` 入口之鍵一併移除）：該解析器含「狀態為 LISTENING」之或條件，在本機類（Windows 11 26300＋KB5127936）系統上，對外連線被錯置為 LISTENING 時會誤判為監聽、`killPortListeners` 因而誤殺不相干之行程；且 netstat 在該類系統上會整列漏列，單靠解析 netstat 文字本就無法回答「誰在監聽」。使用端不應再自行解析 netstat，一律改用 `listenerPids`；引用 `parseListenerPids` 之測試須刪除或改測 `listenerPids`（以 `opt.exec` 注入固定輸出）。
- **回傳語意收緊（契約形狀不變）**：`listenerPids` 仍回 PID **字串**陣列／`[]`／`null`，但 `[]` 現只代表「已確認無人」（Windows 為 netstat 與 `Get-NetTCPConnection` 皆查無），`null` 涵蓋更多失敗（指令不存在、逾時、非預期離開碼、輸出無法解析、port 不合法）；`killPortListeners` 查詢失敗仍回 `{ pids: null, killed: [] }` 且不下殺。
- **新增選項**：`listenerPids` 透傳 `timeout`（每個子指令之逾時毫秒，預設 10000）、`useBoth`（Windows 下 netstat 有查到仍再查 `Get-NetTCPConnection` 取聯集，身分確認用，預設 false）、`onTrace`（觀察回調；失敗訊息為 `settle` 事件之 `msg`）；`killPortListeners` 新增 `timeout`（查詢與下殺共用），其查詢固定傳 `useBoth: true`，不可關。
- **耗時**：在 netstat 漏列之系統上，新起之監聽與無人之 port 一律走 PowerShell，Windows 最久約 2 倍 `timeout`；輪詢迴圈之單輪因而變長。實測數字見 §1 `listenerPids`（wsemi 1.9.50 起改走作業系統 API，不再隨連線數增加）。
- **新增依賴**：`wsemi`（`dependencies`）。

### 標準圖相關

- **框幾何**（`composeBox` 之 `BOX_PAD`／`BOX_STROKE`／圓角、`itemsUnionBox` 之 `fit` 規則與 `inkPad`、`inkRect`、`gridContentBox`、`canvasInkRects` 之墨跡判定）、**截圖序列**（`captureStable` 之 settle、`<img>` 動畫區之靜態影格、遮罩）與**啟動旗標**（`chromiumLaunchArgs`，改動即全量重產）決定各專案標準圖之像素；變更後使用端須重產受影響之圖並逐張審（全域技能 role-coder-for-test-e2e §7.9），發版說明請明列。
- **`itemsUnionBox` 之圖形內容（2026-10-20，Gitea issue #6）**：`graphics` 預設開啟，屬會動使用端標準圖之框幾何類變更——**受影響者：`position:fixed` 浮層之框線帶（量測矩形邊外 1–6px）內有 svg 圖形、可讀 2d canvas 墨跡或 `graphicAreas` 宣告區者，框線改退入浮層內距**；其餘不變（隨機差分與既有等價測試證明）。逃生口 `graphics:false` 逐位元重現 1.0.9；詳見 §2.7。使用端升版後跑一次比對、重產受影響者並逐張審，發版說明須列明。
- 新增函數、新增選項（預設值維持原行為）不影響既有標準圖；一向以「預設值取 w-web-sso 現行行為、其他專案以選項重現」擴充。
- 已知缺陷之部分截圖與 `--names`（Gitea issue #4、#5）：新增 opt-in（`createKnownDefect` 之 `shots`、`runBaselineCase` 之 `defectStages`、`gate.noteKnownDefect`、`createBaselineGate` 之 `log`），**不影響既有標準圖**，使用端不需重產。唯一語意變更：`createKnownDefect(msg, { shots })` 於 1.0.8 靜默忽略 `shots`，此後生效；`gate.finalize()` 回傳值由 undefined 改為 `{ knownDefects }`，有缺陷紀錄時多印摘要；整案缺陷 + `--names` 只命中它時，`finalize` 不再拋錯（離開碼 1 → 0）。部分缺陷路徑會呼叫 `semantic`／`verify`（`ctx.knownDefect` 為該錯誤），自寫包裝遷移時掛鉤須能分流。
- 收集模式、有變更才改寫、埠位移（2026-10-28，Gitea issue #19；§2.8～§2.10）：三項皆預設關閉，**不影響既有標準圖與預設行為**（以 1.0.10 與現行模組之差分 34 組全同——含回傳、錯誤訊息、日誌、寫檔、證據檔名與位元組、服務物件與參數物件之可列舉鍵、`runBaselineCase` 回傳 Promise 之完成微工作時序——與既有測試全綠證明；差分為抽樣，未涵蓋之觀察方式如反射不可列舉屬性另見下列）。新增而不改既有可列舉形狀者：`createServiceManager` 之 `spawn`／`beforeSpawn` 參數之 `port` 與回傳之 `portOf`（皆不可列舉）；共用入口多五個鍵（新增模組 `createBaselineCollector`、`writeBaselineIfChanged`、`resolveE2ePort`、`reviewPendingShots`、`acceptPendingShots`）與 CLI `tools/reviewPending.mjs`；`assertBaselineMatch` 之證據 capture 改以排他建立（非併發時檔名與內容不變，跨行程同毫秒撞名時改用 `-N`）。開啟收集模式者 `it()` 之失敗訊息格式改為 §2.8 之彙整格式，報告判讀程式須配合。
- 依賴升版（playwright 帶入之 Chromium、sharp 之 SVG 光柵化）亦可能改變截圖或紅框像素（推測，需實測確認）；升版後使用端依 §4 等價驗證。
- 首次收錄（2026-09-29）之 `src/` 與四專案 2026-09-28 22:52 起實跑之版本行為相同：51 檔中 48 檔逐位元相同，其餘 3 檔只改註解或等值字面（`compareImageDirs`、`runBaselineCase` 之 JSDoc，`itemsUnionBox` 之字串字面）。
- 2026-09-30（1.0.2 之下一版）：`gridContentBox` 空表之「無資料」訊息改為外擴 `INK_PAD` 後再取聯集，**空表截圖之紅框底下移 4px**（原字形墨跡距框內緣僅 3–4px，低於技能要求之約 5px）。只影響「無資料列」之截圖（有資料列之分支未改）；使用端升版後跑一次比對，失敗者即為全部受影響之圖，取得授權後以 `--write-mode changed` 重產並逐張審；`noRowsPad:0` 可重現舊行為供等價對照。同版其餘變更（`probeStuckTooltip`、`runBaselineCase` 之 `[write]` 日誌、`runIsolatedE2e` 之 `targets` 與啟動方式）不影響截圖像素。

## 6. 開發與測試

- `npm test`：mocha 執行 `test/*.test.mjs`——單元測試（注入假物件）、以 `page.setContent` 之無伺服器瀏覽器測試（首次由 `launchChromium` 下載對應版本之瀏覽器）、`launchChromium` 之全新環境下載測試；不需外部伺服器（`unit-portOffset` 之 `[P05]` 自行起一個本機子行程服務於 127.0.0.1:19030＝基準埠 18930＋位移 100，測完關閉並回驗埠釋放；兩埠須空閒，否則該條失敗並註明）。
- 測試以 cwd 為根，中介檔落 `./test/_tmp/<名>`（gitignore）並於各測試 `after` 刪除。
- `test/e2e-captureEquivalence.test.mjs` 含 w-web-sso／w-web-perm 當時實作之凍結複本（逐位元等價之對照組）與框幾何之專測，屬行為契約，勿因「看起來重複」刪除；凍結複本區段以 `eslint-disable` 註明保持逐字。
- `test/e2e-itemsUnionBoxGraphics.test.mjs`：`itemsUnionBox` 圖形內容（svg 圖形、2d canvas、`graphicAreas`）之真 Chromium 語意/幾何測試，標題前綴 `[ID]` 對應 `CLAUDE_rulebook.md` 表 C；斷言以「無圖形內容時之量框」與「框線外緣不越過內容」為準，無標準圖。
- `test/unit-baselineCollect.test.mjs`（`[C*]`）、`test/unit-keepSame.test.mjs`（`[K*]`）、`test/unit-portOffset.test.mjs`（`[P*]`，含以真實子行程服務於 18930＋100 之實跑）、`test/unit-reviewPending.test.mjs`（`[R*]`，含 CLI 實跑）：Gitea issue #19 三項之開關行為、預設不變、彙整錯誤格式、mtime 不變、位移後之 baseUrl；標題前綴對應 `sgud/rule/rulebook_baselineRun.md` §8.4。
- `test/unit-planE2eShards.test.mjs`（`[S-G*]`、`[S-M*]`，注入值）、`test/unit-removeE2eInstance.test.mjs`（`[S-R*]`、`[S-L*]`、`[S-T*]`，連結目標內放哨兵檔、以會跟進連結之刪除注入）、`test/api-shardE2e.test.mjs`（`[S-I*]`，`test/_tmp/shardE2e/` 下建小專案：真 mocha、真 HTTP 服務、真 junction、真殺**自建**行程與主控台事件；固定埠 19200、19210、19300、19310、19400 須空閒）、`test/unit-shardProcIdentity.test.mjs`（`[S-P*]`、`[S-V*]`，注入行程表與下殺之純判定）、`test/api-shardKillIdentity.test.mjs`（`[S-W*]`，真 mocha 與真鎖檔、行程表疊加夾具列、下殺一律攔下不轉送；固定埠 19500）：分組多開，標題前綴對應 `sgud/rule/rulebook_shard.md`。**後二檔不會對真實行程下殺，變異測試只跑這兩檔**。
- `test/unit-procPrimitives.test.mjs`：行程原語。`listenerPids`／`killPortListeners` 之案以 spawnSync 形替身（`test/tools/portPidsFake.mjs`）驗判定（對外連線錯置為 LISTENING 不得誤判、netstat 漏列由 `Get-NetTCPConnection` 補、查詢失敗回 null 非 `[]`、`useBoth`／`timeout`／`onTrace` 透傳），標題前綴 `[LP*]`（`listenerPids`）／`[KP*]`（`killPortListeners`）；`[RP*]` 為本機真實案：起真實監聽（固定埠 19050）查得到自己、真實子程序監聽（固定埠 19051）被 `killPortListeners` 殺掉並回驗；兩埠須空閒，否則該條失敗並註明。
- lint：`npx eslint --ext .mjs src tools test`。

## 7. 後續候選（未納入）

own 政策（w-web-task 自有 harnessLifecycle；OS 原語已由本套件提供）、`ensureRefImage`（參考片段自舉兩種變體，須連帶涵蓋 outDir）、`waitMutationSettled`（api 時間窗／perm 最近 n 筆兩種演算法待收斂）、openApp／setLang、typeIntoCell、SVG path 定位、遮罩遮擋判定（SKILL §8.2）、跨行程互斥列 v2、echarts 圖例讀取器（w-web-perm `readStaLegend`：讀 zrender 顯示列表取圖例項／翻頁鈕矩形；目前僅 perm 使用）。
