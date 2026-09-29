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
- 依賴只用本套件已列者：playwright（經 `launchChromium`）、pixelmatch、pngjs、sharp、json5；不引入 wsemi／lodash。
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
| `itemsUnionBox(itemSel, {within, scroll, fit, inkPad})` | 量測型目標：可見項目之聯集夾在範圍容器內（清單／樹／選單／時間軸／工具列項目；SKILL §7.2 清單列、§7.3-2 不框整區空白）；`itemSel` 可為選擇器、其陣列或 **Locator**（同一頁內量測函式；Locator 者輸出 `probe` 供被蓋住檢查）；`fit:true` 依**元素自身有無可見邊界**決定量法：有（底色異於背後、邊框、陰影、背景圖、替換元素）量元素本身，無（透明容器、整行文字、開關與其標籤、勾選列、無內距之欄位列）改量**可見內容**（有邊界之子元素框與文字行框之聯集，透明內距不計）並**一律外擴 `inkPad`（預設 `INK_PAD`=4）**——勾選框、開關軌道、圖示與文字同留白，免紅框壓字；可見內容恰為單一有邊界元素（透明外層包著之面板、按鈕）時視同框該元素、不外擴；`fit` 另使**框線不蓋框外內容**：框線中心置於與相鄰項目（自元素往上至多 4 層之緊鄰兄弟，四向各取最近一層）**可見範圍**之間隙正中——可見範圍為有邊界者之元素框、無邊界者之子元素與文字聯集（不取含透明內距之元素框，免把框線拉回目標自身文字）；空白間隔不算鄰項；`position:fixed` 浮層（下拉清單、浮出面板；全畫面者除外）之外的頁面內容以命中測試找（文字、晶片／按鈕／觸發區級之有邊界元件、圖示與表單元件；大容器底色、整張圖表、遮罩後之背景不算），框線置於「目標內容」與「浮層外最近內容」之間隙正中——目標涵蓋整個浮層時（浮層本身、其透明外層包裝或撐滿之面板）以面板內容計（撐滿面板寬或高之標頭列、清單底色屬結構，改看其內文字與元件）、框線可退入面板內距，四周無內容照常外擴；環境變數 `E2E_BOX_DEBUG` 有值時印出量測細節 | 瀏覽器（2026-09-28 新增；同日加 Locator、可見邊界判準（邊框須 ≥ 3 邊）、inkPad、相鄰與浮層夾邊、鄰項改以可見範圍計、浮層改以命中測試取間隙正中、可見內容一律外擴、透明外層之面板） |
| `inkRect(rect, { pad, neighbors })`、`INK_PAD` | 無 DOM 之緊貼墨跡矩形（canvas 圖例列、翻頁箭頭、圖例項等圖表程式庫回報之視窗矩形）外擴 `INK_PAD`（4），交 `captureStableWithBox` 作矩形目標；`neighbors` 為鄰項之可見矩形，框線不越過與鄰項間隙之正中；與 `itemsUnionBox` 之 `fit` 共用同一常數。**目標與鄰項皆須為實際墨跡**（先經 `canvasInkRects`），鄰項須含畫面上有墨跡之全部項目（含被捲動窗裁掉一部分者） | 單元（2026-09-28 新增） |
| `waitAlertGone(page, { sel, timeout })` | 等提示浮窗（wsemi `domAlert`＝w-component-vue `WAlert`／`vo.$alert`，id 以 `alt-` 開頭）全部消失；反應目標不是浮窗本身（例：同一訊息之行內紅字）時，浮窗在不在畫面上取決於時序，先等反應目標就緒再等浮窗消失才截圖，取代「固定等 N 秒」順帶等過浮窗之寫法；逾時拋錯含仍在之浮窗數 | 瀏覽器（2026-09-28 自 w-web-sso login E2E-016 抽出） |
| `canvasInkRects(page, rects, { canvas, alpha, bg, trimY })` | 讀 canvas 像素，把圖表程式庫回報之寬鬆矩形收斂到實際墨跡（左右；`trimY` 亦收上下），無墨跡回 `null`；canvas 預設以矩形中心點命中測試取得，亦可指定；未繪製處須透明（背景不透明者給 `bg` 改以色差判定）；支援高 DPI。用途：echarts／zrender 回報之文字與圖例項矩形比字形寬約 3px，直接交 `inkRect` 取鄰項中點會偏、框線貼到鄰項；被捲動窗裁掉一部分之項目只回可見部分，可作鄰項 | 瀏覽器（2026-09-28 自 w-web-perm 統計圖例抽出） |
| `composeBox` 之 `BOX_PAD`／`BOX_STROKE` | 框幾何預設值（外擴 6、線寬 5）集中匯出，量測端（`itemsUnionBox`、`inkRect`）據以把框線中心置於間隙正中（目標邊 ± 3.5） | 2026-09-28 |
| `composeBox(buf, box, opt)` | 截圖後以 sharp 合成紅框 #f26 / 5px / 圓角 4、外擴 6、夾邊留 3；過小不畫時呼叫 `opt.onSkip(reason)` | sso 實跑、單元 |
| `stepShots(page, opt)` | 「每步兩張」單步：框操作目標 → 操作 → 等反應 → 框反應；`before:null` 表示由前一步之後圖兼任（SKILL §7.3-1），`before` 省略即拋錯 | 單元（2026-09-28 新增，泛化自 perm `*WithShots` 與 sso `capturePermsChangeSave`） |
| `maskRegions` / `overlayRegions` | 截圖後填黑 / 以參考圖同座標貼回 | sso 實跑、單元 |
| `overlayImageAt` / `cropRegion` | 以裁切參考圖貼回（w-web-api 之作法） | 單元（sso 無呼叫端） |
| `assertBaselineMatch(buf, path, label, opt)` | pixelmatch `includeAA:false`、threshold 0.1、maxDiffPixels 100；尺寸不同即敗；testPending 三聯組永不覆蓋（C9）；**只比對不寫檔**（原 `regen` 寫檔旁路 2026-09-28 移除，傳入即拋錯）；通過但計數超過上限 `headroomRatio`（預設 0.5）時印 `[baseline-headroom]` 告警 | sso 實跑、單元 |
| `typeIntoInput` / `typeIntoNthInput` | Pattern D 真人輸入（C10） | sso 實跑、瀏覽器 |
| `waitUntilExist(page, label, fn, opt)` | 偵測驅動等待（C11），預設 10000ms；`fn` 為 async 函數時改逐次 `page.evaluate` 輪詢（`waitForFunction` 會把 Promise 當 truthy 立即放行） | sso 實跑、瀏覽器 |
| `pollUntil(label, fn, { timeout, interval })` | 測試行程端之偵測驅動等待：反覆執行 `fn`（可 async、可用閉包；拋錯視為未成立）直到回 truthy，回傳該值；逾時拋錯含判斷次數與最後一次錯誤。用於瀏覽器外之非同步結果——後端週期計時器寫入資料庫（封鎖、補登記）、背景程序產檔——取代「固定等 N 秒再讀」（計時器於負載高時延遲）；頁面內條件仍用 `waitUntilExist`。預設 30000／200ms | 單元（2026-09-28 自 w-web-sso autoblock 抽出） |
| `collectDomText` / `pageHasText` / `assertTextSpec` | 以 spec 衍生之期望文字做語意斷言（走訪 DOM 文字節點，不判可見性） | sso 實跑（tokens）、瀏覽器 |
| 【w-component-vue】`waitColResizeOverlay` / `waitDrawerReady` | WDrawer 拖曳分隔條 opacity=1 / 抽屜 `[state]` 終態（C12） | sso 實跑、瀏覽器 |
| 【ag-grid】`resetAgGridScroll` / `rowBoxSel` | 截圖前水平捲動歸零 / 整列框選兩選擇器（`order` 決定捲動對象） | perm / task 實跑、瀏覽器、單元（sso 未用） |
| 【ag-grid】`gridContentBox(gridSel, {noRowsSel})` | 量測型目標：標頭 ∪ 可見資料列（空表為標頭 ∪「無資料」訊息），夾在表格框內；取代直接框 `.ag-root-wrapper`（列少時框進大片空白，SKILL §7.2 表格列）；欄位未撐滿表格寬、右側空白 ≥ 200px 且 ≥ 框寬 30% 時右緣收在最後一欄（撐滿者右側僅捲軸槽，不收） | 瀏覽器（2026-09-28 新增；同日加欄寬收邊） |
| 【ag-grid】`waitGridIdle(page, opt)` | 表格靜止：列內容＋容器 / 標頭 / 列幾何＋捲動量簽章連續 `stableMs` 相同；`minCells>0` 時表格未出現亦視為未就緒；取代雙重 rAF（SKILL §8.1 列為無效手法） | 瀏覽器（sso 5 檔 26 處替換中） |

### 1.2 產製與比對管線

| 檔 | 用途 | 狀態 |
|---|---|---|
| `getE2eMode(opt)` | `{ regen, diag, strictCapture }`；regen 且診斷 env 時拋錯（C13 閘門） | sso 實跑、單元 |
| `createBaselineGate(opt)` | `--names` / `--langs` / `--write-mode` / `E2E_BASELINE_OUT_DIR` 之解析與截圖前篩選（§2.2）；`finalize()` 另做孤兒檢查 | sso 實跑（tokens）、單元 |
| `findOrphanBaselines(opt)` | 依案例宣告靜態比對標準圖目錄，列出不是任何案例宣告圖鍵之孤兒圖（與執行了哪些案例無關） | 單元（2026-09-28 新增；PERM 12 張孤兒殷鑑） |
| `runBaselineCase(opt)` | 單一案例管線，產製端與比對端呼叫同一函數（§2.1） | sso 實跑（tokens）、單元 |
| `normalizeShots(result, name)` | Buffer / 物件 / 陣列 / `{buf\|shots,page}` / null → `[{key,buf}]` | 單元 |
| `openCasePage(browser, opt)` | 每案新 context＋頁面＋對話框處理器 | sso 實跑（tokens）、瀏覽器 |
| `createKnownDefect(message, opt)` | 已知缺陷錯誤（SKILL §7.5；產製端不寫圖、比對端 pending） | 單元 |

### 1.3 生命週期與行程

| 檔 | 用途 | 狀態 |
|---|---|---|
| `createServiceManager(opt)` | 沿用政策（reuse）之啟動 / 重啟 / 收尾（C2 / C3，§2.4） | sso 實跑、單元 |
| `registerCleanupHooks(cleanup, opt)` | root after＋exit / SIGINT / SIGTERM；**須於模組頂層呼叫** | sso 實跑、單元 |
| `probeHttp(url, opt)` | 任何 HTTP 回應即 true；`accept` / `identify` 可收緊 | sso 實跑、單元 |
| `createTempSettings(opt)` | 臨時設定檔（JSON5 基底淺合併、tmpDir 必填、forbiddenKeys） | sso 實跑、單元 |
| `runIsolatedE2e(opt)` | 逐檔獨立 mocha 行程（殺 port 以回呼注入） | sso 實跑、單元 |
| 所有權原語 `killOwnTree` / `isChildAlive` / `waitChildExit` / `pidExists` / `sleepSync` | 只殺自建且仍存活之子行程樹（同步）與回驗 | killOwnTree sso 實跑；其餘單元（移植自 w-web-task 並帶其測試） |
| port 政策原語 `killPortListeners` | 殺監聽某 port 之行程——**只可用於專案專屬且已於映射表明文登錄之 port** | sso 實跑、單元 |
| `listenerPids` / `parseListenerPids` | netstat 完整解析（含 IPv6、在地化狀態字）/ POSIX 只取 LISTEN；工具不可用回 null | sso 實跑、單元 |

### 1.4 驗證工具

| 檔 | 用途 | 狀態 |
|---|---|---|
| `snapshotBaselines(dir)` / `diffBaselineSnapshots(a, b)` | 標準圖 sha256＋mtime 快照與比對；「內容相同但被重寫」亦列出 | sso 實跑、單元 |
| `compareImageDirs(dirA, dirB, opt)` | 兩目錄同名 PNG 逐檔比對：位元組相同 ⊂ RGBA 相同 ⊂ 容差內；另報 `rgbaDiff`／`rgbaDiffBox`，`equivalent`＝RGBA 相同或相異像素全在 `opt.drift` 登錄漂移點內（**不以 pixelmatch 計數 0 為等價**：threshold 0.1 下均勻 ≤26 級之亮度差不計） | sso 實跑、單元 |
| `tools/auditWaits.mjs`（CLI） | 固定等待盤點：`node node_modules/w-package-tools-e2e/tools/auditWaits.mjs [--only C,E,R] [--json <out>] <專案根目錄...>`；掃 `test/*.test.mjs` 與 `test/tools/*.mjs` 之每個 `waitForTimeout`，依前後語句分七類——A 偵測後之 settle、B 緩衝後接偵測、L 輪詢間隔、R 隨即離開函式（看呼叫端）、C 後接截圖／讀取／斷言（「固定秒數為唯一同步」候選）、D 後接操作、E 其他。旗標僅為候選：C／E／R 逐一判讀前一動作到預期狀態之間有無非同步來源（伺服器往返、轉址、計時器、廣播、防抖），有則改偵測（頁面內 `waitUntilExist`、瀏覽器外 `pollUntil`）；spec 規定之時間與負向斷言之觀察窗照留 | 單元（2026-09-28 自 w-web-sso 盤點腳本定稿；該日盤出 SSO 251／PERM 67／API 8／TASK 26 處） |
| `tools/auditBoxes.mjs`（CLI） | 標準圖紅框盤點：`node node_modules/w-package-tools-e2e/tools/auditBoxes.mjs [--out <json>] <pics目錄...>`（遞迴、略過 `_` 參考片）；六類候選——`noBox` 無框（#f26 長段 < 20px，SKILL §7.6-3）、`fullFrame` 整張一框、`blank` 框內大片空白（底部 ≥ 120px 且 ≥ 30%，或右側 ≥ 200px 且 ≥ 30%，§7.3-2）、`black` 框內遮黑方塊（§8.2）、`touch` 紅框壓字（§7.3-8）、`cut` 框線外緣緊貼框外字形（框線壓到相鄰內容，§7.3-9）。旗標僅為候選，缺陷與否逐類裁框目視（彈窗／抽屜面板內留白、整列框、元素邊界貼框、有遮罩彈窗之框外背景屬合規） | 2026-09-28 自 w-web-sso 五支掃描器合併；四專案 1024 張與五支舊掃描器逐類計數相同（6/12/105/12/189）；同日加 `cut` |

## 2. 通用規格

### 2.1 產製與比對同管線（C13、SKILL §7.10）

`runBaselineCase({ mode:'regen'|'compare', lang, name, launch, run, pathOf, ... })`：

```
prepare(ctx) → launch() → openPage(browser) → beforeRun(ctx) → run(page, lang, ctx) → normalizeShots
  → semantic(ctx) → verify(ctx)
  → regen：逐張 gate.shouldWrite → gate.decideWrite(write-mode) → 寫入 gate.outPath(pathOf())
    compare：逐張 match(buf, pathOf(), labelOf())（預設首張不符即拋；compareAll 則比完彙總）
  → finally：關瀏覽器（含 run 中換的 ctx.browserRef.current）→ afterCase(ctx)
```

- **全部斷言通過才寫檔**：任一 semantic / verify 失敗，該案一張都不寫。
- 掛鉤收 `ctx = { mode, lang, name, browser, browserRef, page, shots, result }`。只能在測試框架內執行之檢查（例如無法關閉之第三方 API client，SKILL §9.1 只准 api 測試層 root after 強制退出）以 `ctx.mode === 'compare'` 限定，並於測試檔註明依據——**產製端不得以 process.exit 繞過**。
- describe / it、標題、群組、額外之手寫 it 留在測試檔；測試檔之 regen 迴圈與 mocha 之 it 皆呼叫同一個 `runBaselineCase` 與同一組掛鉤。
- `allowEmpty` 預設 false：案例未產生截圖即拋錯（防比對端空轉假綠）。
- `compareOnly`（共用他案標準圖之案例，SKILL §7.8 ①）：產製端照跑流程與全部斷言、一張都不寫，回傳 `status:'compareOnly'`（避免同一張被兩案輪流重寫，w-web-api edit E2E-005 殷鑑）；比對端照常比對。案例直接宣告其比對之共用圖鍵為 `stages`，run 回傳 `{ 共用圖鍵: buf }`（裸 Buffer 以案例鍵命名，會與宣告不符）；fail-dump 標籤宜帶案例名以分辨哪一案失敗。
- `gate` 給定時，`runBaselineCase` 以 `gate.usePathOf(pathOf)` 告知標準圖路徑函數，供 `finalize()` 之孤兒檢查。
- `stages`：給定時產出圖鍵集合須與宣告相同，否則拋「多 [...] 少 [...]」（防宣告、產製、比對三處命名不同步）。
- 已知缺陷：run 中拋 `createKnownDefect(...)` → 產製端不寫圖、回傳 `status:'knownDefect'`；比對端呼叫 `onKnownDefect`（mocha：`() => this.skip()`）。

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
- 產製前印 `gate.describe()`；全部案例跑完呼叫 `gate.finalize()`。

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
- `restart(name, { args, env, hookArg })`：有自建 → 同步殺樹並等 port 釋放（上限 `portReleaseTimeoutMs`）；殺後仍被佔（另有同專案實例，例如手動啟動者）或無自建而 port 被佔 → `killForeignOnRestart:true` 才殺監聽者（無自建時預設 false 拋錯；殺自建後仍被佔且未允許者只記錄並繼續）；env 與 process.env 淺合併且只作用於本次；**restart 不改一次性狀態**。
- 服務之 `beforeSpawn({ phase, args, env, hookArg })`：每次 spawn 前呼叫並等待，`phase` 為 `'start'`（startServersOnce 確定要 spawn 時；沿用時不呼叫）或 `'restart'`（`hookArg` 取自 restart 之 opt）——供「服務啟動前必須完成」之前置：w-web-api 首次啟動前 `npm run build`、w-web-perm 首次啟動前重建資料庫與 `restart(…, { hookArg:{ reseed:true } })` 之重新播種。
- `cleanup()`：同步（exit / 訊號處理器內非同步不會被等待）、依 services 反序殺自建、重置一次性狀態、呼叫 `onCleanup`。觸發來源兩條：`registerCleanupHooks`（root after＋exit / 訊號備援）與直跑主函式末尾顯式呼叫。
- **own 政策 v1 不支援**（只用自建、port 被佔即報錯、綁定失敗字樣偵測、監聽者回驗、跨行程互斥）；參考實作為 w-web-task `test/tools/harnessLifecycle.mjs`。

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
| `E2E_BOX_DEBUG` | `itemsUnionBox` | 有值時印出各元素之可見範圍、浮層矩形、浮層外最近內容與夾邊前後（審圖查因用） |
| `--names`、`--langs`、`--write-mode` | `createBaselineGate` | 產製篩選，見 §2.2 |

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

- **框幾何**（`composeBox` 之 `BOX_PAD`／`BOX_STROKE`／圓角、`itemsUnionBox` 之 `fit` 規則與 `inkPad`、`inkRect`、`gridContentBox`、`canvasInkRects` 之墨跡判定）、**截圖序列**（`captureStable` 之 settle、`<img>` 動畫區之靜態影格、遮罩）與**啟動旗標**（`chromiumLaunchArgs`，改動即全量重產）決定各專案標準圖之像素；變更後使用端須重產受影響之圖並逐張審（全域技能 role-coder-for-test-e2e §7.9），發版說明請明列。
- 新增函數、新增選項（預設值維持原行為）不影響既有標準圖；一向以「預設值取 w-web-sso 現行行為、其他專案以選項重現」擴充。
- 依賴升版（playwright 帶入之 Chromium、sharp 之 SVG 光柵化）亦可能改變截圖或紅框像素（推測，需實測確認）；升版後使用端依 §4 等價驗證。
- 首次收錄（2026-09-29）之 `src/` 與四專案 2026-09-28 22:52 起實跑之版本行為相同：51 檔中 48 檔逐位元相同，其餘 3 檔只改註解或等值字面（`compareImageDirs`、`runBaselineCase` 之 JSDoc，`itemsUnionBox` 之字串字面）。

## 6. 開發與測試

- `npm test`：mocha 執行 `test/*.test.mjs`——單元測試（注入假物件）、以 `page.setContent` 之無伺服器瀏覽器測試（首次由 `launchChromium` 下載對應版本之瀏覽器）、`launchChromium` 之全新環境下載測試；不需任何伺服器。
- 測試以 cwd 為根，中介檔落 `./test/_tmp/<名>`（gitignore）並於各測試 `after` 刪除。
- `test/e2e-captureEquivalence.test.mjs` 含 w-web-sso／w-web-perm 當時實作之凍結複本（逐位元等價之對照組）與框幾何之專測，屬行為契約，勿因「看起來重複」刪除；凍結複本區段以 `eslint-disable` 註明保持逐字。
- lint：`npx eslint --ext .mjs src tools test`。

## 7. 後續候選（未納入）

own 政策（w-web-task 自有 harnessLifecycle；OS 原語已由本套件提供）、`ensureRefImage`（參考片段自舉兩種變體，須連帶涵蓋 outDir）、`waitMutationSettled`（api 時間窗／perm 最近 n 筆兩種演算法待收斂）、openApp／setLang、typeIntoCell、SVG path 定位、遮罩遮擋判定（SKILL §8.2）、跨行程互斥列 v2、echarts 圖例讀取器（w-web-perm `readStaLegend`：讀 zrender 顯示列表取圖例項／翻頁鈕矩形；目前僅 perm 使用）。
