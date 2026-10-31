# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 套件身分與相容紀律(最高優先)

- 本套件是 w-web-sso、w-web-perm、w-web-api、w-web-task 四專案 e2e 共用設施之發佈源.使用端一律經各自 `test/tools/e2eLib.mjs` 單一橋接引用(`export { default as X } from 'w-package-tools-e2e/src/X.mjs'`), 共用層與測試檔只自橋接 import.
- 各函數預設值即 w-web-sso 現行組態, 其他專案之差異以選項重現.新增函數或選項一律維持原預設行為(opt-in), 才不動到使用端既有標準圖.
- 會改變使用端標準圖像素之變更: 框幾何(`BOX_PAD`／`BOX_STROKE`／圓角、`itemsUnionBox` 之 fit 與 inkPad、`inkRect`、`gridContentBox`、`canvasInkRects`)、截圖序列(`captureStable` 之 settle、靜態影格、遮罩)、啟動旗標(`chromiumLaunchArgs`, 改動即全量重產)、依賴升版(playwright 帶入之 Chromium).改之前先評估, 發版說明明列, 使用端須重產受影響之圖並逐張審.
- 深層引用 `w-package-tools-e2e/src/<名>.mjs`, 無 `main`／`exports`: 任何檔都可被引用; 套件內不能以套件名引用自己, 測試一律以 `../src/` 相對引用.
- 共用入口 `src/WPackageToolsE2e.mjs`(2026-09-29, 仿 w-dispatch-ai 之 `WDispatchAi.mjs`): 匯入 `src/` 內其他全部模組並加 `BOX_PAD`／`BOX_STROKE`／`INK_PAD`, 依 README §1 分組排列; 引用它會一併載入全部模組與依賴(playwright、sharp).`tools/*.mjs` 為可執行腳本(引用即解析 argv, 無參數時 `process.exit(2)`), 絕不可匯入入口.`test/unit-WPackageToolsE2e.test.mjs` 以目錄列舉守門: `src/` 新增模組未登錄於入口即失敗(已以暫放未登錄之探針模組驗證會擋).
- 依賴只用 playwright(經 `launchChromium`)、pixelmatch、pngjs、sharp、json5, 以及 wsemi(2026-10-30 起, 僅 `listenerPids` 深層引用 `wsemi/src/execProcessPortPidsSync.mjs`, 不經 wsemi 主入口之 dist 全包); 不引入 lodash.外部副作用(exec、spawn、fetch、process、globalThis、寫檔函數或落點)皆可由 opt 注入, 行程類原語因此能以假物件單元測試.

## 功能與目的(2026-09-30 現況)

| 類 | 模組 | 目的 |
|---|---|---|
| 啟動 | `launchChromium`(核心流程 `launchChromiumCore` 以注入依賴供單元測試) | 所需版本之瀏覽器不存在時以 Playwright 自身 CLI 下載後啟動(不依賴安裝腳本); Linux 缺系統相依時先 install-deps; 指定 `channel` 或 `executablePath` 時不自動安裝 |
| 啟動 | `chromiumLaunchArgs`、`launchBrowser` | 確定性渲染六旗標(凍結陣列)與唯一 launch 出口; headless 預設之 GPU 光柵化與次像素字形使像素比對不確定 |
| 截圖 | `captureStable` | 標準圖截圖唯一入口: 排除「還沒穩定」與「穩定到錯的狀態」後連拍至相鄰兩張相同 |
| 截圖 | `waitColResizeOverlay`、`waitDrawerReady`(w-component-vue); `resetAgGridScroll`、`waitGridIdle`(ag-grid) | 技術棧就緒訊號: 元件狀態機優先於幾何輪詢 |
| 截圖 | `probeStuckTooltip`(w-component-vue) | 截圖前守門: 游標已移開而 hover 型提示框(WTooltip `mode='tooltip'`)仍顯示即拋錯, 防殘留凍結進標準圖; 置於 `beforeShots` 首位 |
| 紅框 | `captureStableWithBox`、`composeBox` | 截圖後以 sharp 合成紅框(不注入 DOM); 標準圖兼作操作手冊用圖 |
| 紅框 | `itemsUnionBox`、`gridContentBox` | 量測型目標: 框實際有內容之項目聯集, 不框整區空白 |
| 紅框 | `inkRect`、`canvasInkRects` | canvas(圖表)等無 DOM 目標: 收斂到實際墨跡再外擴留白 |
| 紅框 | `rowBoxSel`、`stepShots` | ag-grid 整列框選; 「每步兩張」(框目標 → 操作 → 等反應 → 框反應) |
| 遮罩 | `maskRegions`、`overlayRegions`、`overlayImageAt`、`cropRegion` | 凍不到之動態區: 填黑或以參考圖貼回 |
| 比對 | `assertBaselineMatch` | 反鋸齒感知像素比對加容差, 失敗留三聯組證據; 只比對不寫檔 |
| 產製管線 | `runBaselineCase`、`createBaselineGate`、`findOrphanBaselines`、`normalizeShots`、`openCasePage`、`createKnownDefect`、`getE2eMode` | 產製端與比對端呼叫同一案例函數; 截圖前篩選; 孤兒檢查; 已知缺陷分流 |
| 等待 | `waitUntilExist`、`pollUntil`、`waitAlertGone` | 偵測驅動等待(頁面內／測試行程端／提示浮窗消失), 取代固定秒數 |
| 輸入與斷言 | `typeIntoInput`、`typeIntoNthInput`、`collectDomText`、`pageHasText`、`assertTextSpec` | 受控輸入框之真人輸入(Pattern D); spec 衍生文字之語意斷言 |
| 生命週期 | `createServiceManager`、`registerCleanupHooks`、`probeHttp`、`createTempSettings`、`runIsolatedE2e` | 服務沿用或啟動、同步收尾、臨時設定、逐檔獨立 mocha 行程(`targets` 可點名檔案與 `--grep`) |
| 行程原語 | 所有權: `killOwnTree`、`isChildAlive`、`waitChildExit`、`pidExists`、`sleepSync`; port 政策: `killPortListeners`、`listenerPids`(`parseListenerPids` 已於 2026-10-30 移除) | 只殺自建行程樹並回驗; 專屬 port 之監聽者處置 |
| 驗證工具 | `snapshotBaselines`、`diffBaselineSnapshots`、`compareImageDirs` | 證明「零標準圖變動」之快照與等價比對 |
| CLI | `tools/auditBoxes.mjs`、`tools/auditWaits.mjs` | 標準圖紅框六類盤點; 固定等待七類盤點(旗標只是候選, 須逐項判讀; 用法見 `sgud/proc/process.md`) |

## 為何自建而不用現成方案(對標 Playwright Test／jest-image-snapshot／BackstopJS)

- 標準圖兼作業主審閱之操作手冊: 紅框截圖後合成、檔名 `<flow>-<lang>-E2E-NNN-<序>-<kebab>.png` 可讀、該讓讀者看到之畫面不填黑.三者皆無紅框.
- 審圖制: 重產須授權並逐張審, 故以 `--names`／`--langs` 截圖前篩選與 `--write-mode missing|changed` 取代整批 `--update-snapshots`.
- 失敗證據永不覆蓋、不自動刪(Playwright 每次覆蓋): 偶發 flake 之當次證據常隔天才分析.
- 每案全新瀏覽器行程(確定性優先), 非每 worker 共用.
- 否決改用 @playwright/test 或 CLI 化: 與「scripts 只留 test」及審圖制衝突.
- 比對參數刻意較嚴: pixelmatch `includeAA:false`、threshold 0.1(Playwright 預設 0.2)、maxDiffPixels 100; 尺寸不同直接失敗.

## 已定之取捨(除非出現新證據, 勿重議)

1. **單一案例管線, 不做套件級產生器**: `runBaselineCase` 讓兩端「呼叫同一函數」, describe／it 留測試檔.否決 `defineBaselineSuite`: 四專案之流程拓撲、瀏覽器粒度、設定切換層級、多 describe、只比對案例、回傳形狀皆異構, 產生器須先吞下全部變體.`runBaselineCase` 與 mode 無關, 直跑 `--baseline` 與 mocha REGEN 兩種產製入口皆可用.
2. **全部斷言通過才寫檔**: 任一 semantic／verify 失敗該案一張都不寫.抽提前四專案之產製端幾乎都不跑語意斷言即寫檔(sso 14/14、perm 10/10、task 1/1; api 先寫圖後斷言), 這是本管線要消除之主因.
3. **`assertBaselineMatch` 只比對不寫檔**: 原 `regen` 旁路(第二條寫檔路徑、先寫圖後斷言)已移除, 傳入即拋錯.
4. **紅框截圖後合成、不注入 DOM**: 插入後又移除之暫時 DOM 偶發使整頁光柵化偏 1px.夾邊 `clampTo:'buffer'|'viewport'` 兩者皆提供(頁高 ≤ 視窗時等價).
5. **目標、遮罩、捲動量於截圖前同一時點量**.
6. **服務生命週期 v1 只有沿用政策(reuse)**: port 有回應即沿用、否則 spawn、只殺自建.own 政策(只用自建、佔用即拋錯、綁定失敗偵測、跨行程互斥)未入, 參考 w-web-task `test/tools/harnessLifecycle.mjs`.
7. **`restart` 不改一次性狀態; `cleanup` 重置一次性狀態**(抽提前各專案不一致, 以 sso 語意統一); 啟動失敗語意 `failureMode:'once'`(預設)或 `'sticky'`.
8. **行程查詢工具不可用時原語回 null, 由呼叫端決定**: fail-closed 與否屬專案政策, 不寫死於套件.
9. **不收**: `maskBelowY`(四專案零呼叫端)、`waitMutationSettled`(api 時間窗與 perm 最近 n 筆兩種演算法未收斂)、程序級假時鐘(契約 C15; 四專案 e2e 未用, 無可驗證之用例).**留在各專案、不抽**: DB 重置與種子(資料模型各異)、伺服器注入語系模板之還原(各專案做法實質不同).
10. **sharp 不鎖精確版本**: 2026-09-29 實測 0.35.3 與 0.35.5 之紅框合成與 SVG 靜態影格逐位元相同; 跨次版本未實測.
11. **發布範圍維持既有政策**: 無 `files`／`.npmignore`, `test/` 隨發布; `tools/` 使用端需要, 不可排除.

## 注意事項: 截圖與穩定

- `captureStable` 序列不可調換: 停滑鼠 → 初始等待(1500ms, 涵蓋 setTimeout 延遲顯示; `animations:'disabled'` 不快轉 setTimeout) → settle → 凍 inline SVG SMIL → 等字型 → beforeShots → `<img>` 動畫區處理 → 連拍(8 × 200ms).
- 雙重 rAF 之表格 idle 已驗證無效(純文字簽章抓不到 1px 位移) → `waitGridIdle` 以「內容＋容器／標頭／列幾何＋捲動量」簽章連續穩定判定.
- `strict` 未給時於**每次呼叫**求值 `strictDefault()`: 若於 import 時求值, 產製端在 import 之後才設 `E2E_STRICT_CAPTURE` 會靜默失效.
- `<img>` 內 SVG SMIL 由 image pipeline 渲染、DOM 凍不到: 預設 `imgSmilFill:'static'` 貼去動畫之靜態影格(填黑會讓手冊之連線中畫面變黑方塊), 超界者退回填黑.座標須與截圖座標系一致(`smilRectBasis:'auto'`): 抽提前四專案之全頁截圖皆用視窗座標, 頁面捲動後遮罩落錯位置、動畫露出, 且 Chrome 暫停視窗外之 `<img>` 動畫 → 連拍「穩定」在不固定影格(頁高 ≤ 視窗時兩者等價, 故長期未被觀察).
- 截圖相關之等價測試: 每次截圖前重新載入頁面, 並有反向對照(拿掉掛鉤必不同); 同一頁先後截兩次會「搭便車」吃到前一次已等完之狀態, 測不出差異.
- `openCasePage` 之 viewport 等確定性參數由專案以 `contextOptions` 給定, 不給即 Playwright 預設 1280×720; 抽提期紀錄 sso 用預設、perm／api／task 用 1440×900.改此預設會動到使用端像素.
- **提示框殘留與 `probeStuckTooltip`**(2026-09-30): 游標下節點被移除替換後, 瀏覽器未對觸發區派發 mouseleave → hover 提示框殘留並被凍結進標準圖(成因、判別與處置見全域技能 role-coder-for-test-e2e 之提示框殘留列).Playwright 1.62.1 之預設啟動參數停用 `BoundaryEventDispatchTracksNodeRemoval`(使用端 `playwright-core/lib/coreBundle.js`; issue #38568), 本套件鎖檔之 1.63.0 其 `lib/` 查無此字(不再停用): 同一測試於兩版之邊界事件語意不同.`probeStuckTooltip` 以 WTooltip 內部結構辨識(`$refs.divTrigger`／`divContent`、`props.mode`、`data.valueTrans`), 元件改寫時會一律回空而不報錯; 套件測試只用模擬元件樹(`test/e2e-probeStuckTooltip.test.mjs`), 真元件另以 Vue 2.7.16＋w-component-vue 2.5.24 之 UMD 頁驗收 6/6(作法見 `sgud/proc/process.md` 之升級複驗).

## 注意事項: 紅框

- **找不到目標、尺寸為 0、夾邊後過小一律拋錯**, `allowNoBox:true` 才容許無框.殷鑑: `[style*="padding:10px 15px"]` 永不命中(瀏覽器序列化為 `padding: 10px 15px;`), 靜默回無框圖, 兩張無框標準圖比對永遠通過; 有無框只能以像素掃描(`tools/auditBoxes.mjs` 之 noBox)證明, 不能以呼叫的函數名判定.
- **被蓋住檢查**: 目標中心之最上層元素非目標本身、子孫或祖先即拋錯(框了被彈窗蓋住的東西); 全量盤查時設 `E2E_COVER_CHECK=warn` 只告警.
- **捲入會製造假畫面**: 目標比其可視區大且已部分入鏡時, 捲入只會改變版面; 使用者此刻不會捲動者(切分頁後之整個檢視面板)用 `scrollTall:false` 或 `itemsUnionBox(loc, { scroll: null })`; 預設仍捲入並印 `[box-scroll]`.
- **框壓字**: 框幾何為目標 ±6(`BOX_PAD`)、5px(`BOX_STROKE`)描邊內縮, 框內緣只距目標 1px; 無可見邊界且緊貼文字之目標改用 `itemsUnionBox(目標, { fit: true })`(可見內容一律外擴 `INK_PAD`=4), canvas 矩形用 `inkRect`.**不要改全域框幾何**(牽動上千張既有圖).
- **元素矩形不是字形墨跡**(2026-09-30): 文字元素之矩形含行框於基線下方等空間, 以矩形推論「框壓字」會失真.使用端建議文件稱 `gridContentBox` 空表訊息「壓字」, 以 `tools/auditBoxes.mjs` 掃描並裁切放大實測 6 張為字形距框內緣 3–4px(未壓字, 但低於技能 §7.3-8 約 5px 之要求).處置: 空表「無資料」訊息四周外擴 `noRowsPad`(預設 `INK_PAD`=4, 同 fit 之文字外擴), 聯集後仍夾在表格框內; `noRowsPad:0` 重現舊行為.空表截圖之紅框底因此下移 4px, 有資料列之分支不變.
- **框線不蓋框外內容**: 框線置於與相鄰項目「可見範圍」之間隙正中(以含透明內距之元素框取中點, 會把框線拉回目標自身之字); 浮層(position:fixed)外之內容以命中測試找; 圖表程式庫回報之文字／圖例矩形常比字形寬約 3px, 先經 `canvasInkRects` 收斂再給 `inkRect` 之 `neighbors`, 鄰項須含被捲動窗裁掉一部分者.查因時設 `E2E_BOX_DEBUG=1`.
- **大型 svg/canvas 圖形對浮層框線之盲區(issue #6, 2026-10-20 審計 run01、修正 run02 已併入 `graphics`/`graphicAreas`,規則見 `sgud/rule/rulebook.md` §7)**: `contentAt` 以 `elementsFromPoint` 命中後沿祖先找文字或有邊界者, 祖先寬 > 480 或高 > 120 即中止, 故大型 svg 內之圖形、canvas 像素皆判無內容(`src/itemsUnionBox.mjs:201-235`); 現行版於真 Highcharts/Plotly/ECharts 掃 72 個浮層位置, 框線帶蓋到資料線者 51–56 個.**審計實測之教訓**: ①issue 建議「命中圖形且有可見 stroke/fill 即內容」之字面實作不夠——撐滿圖表之底色 rect 會使每個位置皆被當內容(66/72 無謂改框)、Highcharts 預設之透明追蹤線(`rgba(..,0.0001)` 22px 寬)擋在真線之上、Plotly 之 `.main-svg` 為 `pointer-events:none` 命中測試根本找不到; 須改以幾何判定(`getScreenCTM` 反矩陣 + `isPointInStroke/isPointInFill`, 不依賴命中測試).②沿邊取樣範圍只取內容範圍 `inner`(文字寬約 30px)而浮層寬 120px, 資料線橫貫浮層下緣右半時完全掃不到(只修 `contentAt` 殘留 33/72)——圖形須沿**框線全長**逐 px 取樣(2px 間距會漏掉落在像素格線上之 1px 垂直線).③只在框線帶(目標邊外 1 至 6px)內介入, 不沿用舊規則另留之 2px(使距外緣數 px 之淡格線使既有標準圖無謂改動; w-web-perm stainfor E2E-005-2 之下拉框外緣距 ECharts 格線僅約 3px).④角落 6x6 不掃(掃了會使平行於浮層邊之線誤退鄰邊); 但**掃描須含緊鄰矩形邊之一列/行作守距**——貼著浮層側邊、伸到浮層下方之柱(縱向內容)在角落處與框線相交, 只掃精確之框線帶會漏(外審修正後第一次真圖表掃描 Highcharts 柱狀圖 24 位置中 14 處蓋墨跡, 守距列補上後 0).⑤`getContext('2d')` 對從未繪製之 canvas 會建立 2d context 而使其後 `getContext('webgl')` 失效, 讀像素改以 `drawImage` 至離屏小畫布.⑥退入位置取間隙正中會使框縮到只剩文字範圍(浮層比文字寬時), 圖形改為「外緣退到內容前 1px、放不下 5px 描邊才取正中」.⑦**`document.elementsFromPoint` 對 HTML 方塊之命中區為 [x,x+1)×[y,y+1)**(Chromium 153 實測: 小數座標向右下延伸, 以像素中心 x+0.5 取樣會把右/下一像素之元素也算進來, 緊貼浮層左緣之柱被判成浮層蓋住); svg 圖形之命中則為精確幾何(0.6px 線在 y∈[218.2,218.8] 內命中、之外不命中). 故 HTML 層疊(浮層蓋住、底色蓋住)用整數座標, 只有 svg 細線之 clip-path 確認與 svg 遮片疊序用實際命中點.⑧外審(sol、minimax 各一, 兩者皆自行讀碼寫探測)共 17 條(sol 11 + minimax 6), 逐條自行實測核對皆屬實(2 組重疊: sol#5/mm#3 取樣界、sol#9/mm#4 測試缺口; 4 條為測試/驗證缺口: sol#9、mm#4–#6, 其餘為程式缺陷), 類別: 夾制退化撤銷 HTML 避讓; 各 canvas 共用離屏畫布(一張污染, 後續全讀不到); 遮蓋判定漏累積 opacity/svg 遮片/透明 canvas; 裁切確認點不在幾何命中點; 取樣界(首末欄、小數邊、四向起點不一致); svg 底色比對用頁面底色(黑底圖表); tspan 樣式; 現代色彩被當不透明黑; canvas 內容盒/object-fit; 粗描邊預篩; 候選範圍不含框矩形(0x0 外層包大面板). 教訓: 每個「位置×方向×內容型別」格類都要逐格實測, 不以代表格推論; 改掃描邏輯後必重跑真圖表掃描(它抓到了自己測試沒抓到之守距列回歸).修正後測試 `test/e2e-itemsUnionBoxGraphics.test.mjs` 103 條.
- **`rowBoxSel` 順序不中性**: `captureStableWithBox` 只把第一個目標捲入視窗, 順序決定捲動對象; 預設 sso 之 `['pinned-left','center']`, perm／task 用 `order:['center','pinned-left']`.

## 注意事項: 產製與比對

- 只能在測試框架內執行之檢查(例: 無 close 之 API client, 只能靠 api 測試層 root after 強制退出)以 `ctx.mode === 'compare'` 限定; **產製端不得以 `process.exit` 繞過**.
- 比對端多階段案例預設首張不符即拋錯, 後續階段根本沒被比對: 失敗清單少於實際受影響張數, 據以決定重產範圍會漏; 需要完整清單時用 `compareAll:true`(比完再彙總), 或以案例為單位把全部階段列入 `--names`.
- `allowEmpty` 預設 false: 案例未產生截圖即拋錯, 防比對端空轉假綠.`stages` 宣告後產出圖鍵集合須完全相符(防宣告、產製、比對三處命名不同步).
- **共用他案標準圖之案例宣告 `compareOnly`**: 否則同一張被兩案輪流重寫.其比對之共用圖鍵直接宣告為 `stages`, run 回傳 `{ 共用圖鍵: buf }`; 共用圖鍵不參與 `--names` 寫檔解析(否則會誤判為多案例共有).
- `--names` 採邊界前綴(`E2E-005` 不命中 `E2E-0051-x`); 不符任何鍵、命中只比對案例、旗標缺值或其值以 `--` 開頭一律於截圖前拋錯並列可用鍵(抽提前各檔篩選未命中一律靜默).`--langs` 完全比對.
- `E2E_BASELINE_OUT_DIR` 只涵蓋經 `runBaselineCase` 之寫檔; 參考片段(`_ref`)自舉與測試檔自行 `fs.writeFileSync` 之處不在內, 未遷移前不得以 outDir 做等價驗證(會寫進正式目錄).
- 改名後重產只寫新名、從不刪舊名 → 孤兒圖; `createBaselineGate().finalize()` 以 `findOrphanBaselines` 依宣告靜態比對目錄(與執行了哪些案例無關), 有孤兒即拋錯.
- **等價不以 pixelmatch 計數 0 判定**: threshold 0.1 下整片均勻約 26 級以內之亮度差不計; 以 RGBA 全等或登錄漂移點(`compareImageDirs` 之 `drift`, 須附成因與證據)判定.通過但計數逾 `maxDiffPixels` 一半即零餘裕(印 `[baseline-headroom]`), 應查因或重產.
- 失敗證據檔名 `<label 淨化>__<ISO 至毫秒>__{capture,baseline,diff}.png`, 撞名加 `-N`, 落 `./testPending/`, 永不覆蓋、不自動刪.三者分工: `test/_tmp/` 測試中介資料(測完即刪)、`./testPending/` 失敗證據(人工清理)、`./tmp/` AI 暫存區(測試禁用).
- 已知缺陷: 走到徵狀即拋 `createKnownDefect(...)` → 產製端不寫圖(回 `status:'knownDefect'`)、比對端呼叫 `onKnownDefect`(mocha 之 `this.skip()`); 壞畫面不得凍結為標準圖.
- **已知缺陷分兩種**(2026-10-20, issue #4／#5): 整案(錯誤不帶 `shots`, 行為同 1.0.8)與部分(帶 `shots`+`defectStages`, 缺陷之前的步驟照常產製與比對).技能 §7.5 本意是「跳過**該步**」, 1.0.8 實作成跳過**整案**, 缺陷落在後段時前段回歸被 pending 掩蓋(實測: 前段改色仍回 PENDING).規則帳本 `sgud/rule/rulebook.md` 表 A／表 B 為權威, 此處只記取捨:
  - 部分缺陷路徑**仍過 `semantic`／`verify`**(技能 §7.10 全部斷言通過才寫檔); 代價是既有掛鉤須以 `ctx.knownDefect` 分流.
  - 圖鍵**三向核對**(多／重疊／少)不可省: 只做「stages 扣除 defectStages」會讓拼錯鍵、壞畫面混入、缺陷早於預期被靜默吞掉.`defectStages` 必與 `stages` 併用.
  - 帶 `shots` 之已知缺陷**僅能由 run 拋出**; 掛鉤或 run 之前拋出者視同一般錯並載明位置, 否則會被誤當部分缺陷.
  - 前段比對全過才呼叫 `onKnownDefect`; 前段不符就讓測試紅, 不是 pending.
  - `runBaselineCase` **自動**通知 gate(`typeof gate.noteKnownDefect === 'function'` 守門), 使用端既有直跑迴圈只升版即可; 摘要放 `finalize`(回傳+`log`), 不放 `describe()`(跑案例前呼叫, 放不下結果).
  - 寫檔迴圈與比對迴圈各抽成閉包(`writeShots`／`compareShots`)供正常與缺陷路徑共用, 避免兩份碼; `status` 維持 `'knownDefect'`(新增狀態會破壞使用端判斷), 以 `out.defectStages` 區分.
  - 已知限制: 未宣告 `stages` 之案例整案缺陷時, ④token 無法驗證圖鍵(不拋); `semantic`／`verify` 自身拋未帶 shots 之已知缺陷維持整案.
  - 外審(2026-10-20, sol＋minimax)補出之教訓: ①**共用迴圈不夠, 進入共用迴圈前後的狀態處理也要共用**——部分缺陷路徑曾漏掉 `{shots,page}` 換頁(`adoptPage`)與掛鉤重新指定 `ctx.shots`(寫出/比對須用 `ctx.shots` 而非進場時的 `front`), 兩路徑自此共用 `adoptPage` 與 `ctx.shots`; ②降級(掛鉤另拋整案缺陷)要清掉部分缺陷專屬狀態(`ctx.knownDefect`、`out.defectStages`), 否則 `afterCase` 或自寫包裝會誤判; ③缺陷路徑也要有 `allowEmpty` 把關(前段為空而未宣告 stages), 否則缺陷發生於第一張之前會被歸為 pending 空轉; ④對外 API 的參數型別要驗(`noteKnownDefect` 的 `keys` 傳字串曾靜默擴大成整案豁免), 回傳物件要複製(`finalize` 摘要的 `keys`); ⑤測試漏洞用變異才看得見——`afterCase` 與 outDir 路徑在缺陷分支被改壞時 64 條測試仍全綠, 補斷言後變異才轉紅; ⑥token 層級(any-of)的覆蓋語意是 `noteProduced` 一向如此, 本次延伸到缺陷紀錄並明載為已知限制(表 B 的 B21), 不順手改 `finalize` 判定語意.
  - 審計時的教訓: 建議書稱「圖鍵拼錯之正常案例 finalize 照舊拋」不準——宣告 `stages` 者於 `createBaselineGate` 構造時即拋, 只有④路徑才落到 `finalize`; 建議書所指行號逐條對現行碼核實後才採納.
- 改共用層或管線時走等價驗證(README §4): 先以現行碼產到暫存目錄得對照組, 再分段(只換原語 → 換管線)各自比對, 差異才能歸因到哪一步.
- **收集模式(2026-10-28, issue #19)之取捨**(權威為 `sgud/rule/rulebook_baselineRun.md`):
  - 收集只在案例範圍(AsyncLocalStorage)內發生, `assertBaselineMatch` **不讀 `E2E_COLLECT`**: 若改成「env 一開就收集」, 不經 `runBaselineCase`／`collector.run` 之直呼點會把不符吞掉而無人彙整 → 假綠.變異 M02 即此形狀.
  - 其他錯誤(語意斷言等)**原樣拋出不改訊息**: 改訊息會破壞使用端判讀與 AssertionError 之 actual/expected; 已收集之不符改以一行日誌、`err.baselineCollect`、案例清單 `outcome:'failed'` 呈現.`failed` 案例之截圖可能是壞畫面, 採用工具拒收.
  - 收集到不符時不呼叫 `onKnownDefect`: 不收集時那一張早已拋錯(失敗), 收集後若仍 pending 即是以 pending 掩蓋回歸.
  - 與產製互斥(拋錯而非忽略): 環境變數常設在殼層, 靜默忽略會讓使用者以為產製趟也在收集.
  - 證據目錄永不自動清除 → 審查／採用須給 `since`(本趟開始時間), 否則本趟已通過之標籤之舊證據會被列為待審甚至被採用(採用之過期檢查只驗標準圖是否變過, 擋不住這種情形).
  - 採用一律「先全部驗證、再複製」: 逐一驗證逐一複製時, 第 3 個不合格前 2 個已寫入(變異 M30).
  - 外審(terra, 2026-10-28)22 條全屬實或部分屬實, 自審表漏掉之軸: ①**範圍之壽命**(run 結束後遺留之計時器仍繼承 ALS store; 範圍外傳入之收集器物件) → 收集器加 `open`;②**巢狀**(外層收集範圍內之 regen 被收集而照寫標準圖) → regen 遇外層啟用範圍即拋、未啟用收集者以 `store.run(null)` 遮蔽;③**收尾階段**(已知缺陷路徑提早 flush 後 afterCase 拋錯, 清單誤為 mismatch 而可採用) → 延後標記, 收尾後才定結局;④**副作用本身失敗**(日誌回呼或清單寫入拋錯取代原錯誤);⑤**跨目錄、跨行程**(清單只寫第一個目錄、同毫秒同標籤共用 stem) → 每目錄一份、`wx` 排他建立;⑥**採用之目的地**(兩標籤同一標準圖、相對路徑在他目錄執行、裁圖目錄與標準圖撞名).教訓: 「採用」是寫標準圖之動作, 其輸入空間要以「最終寫到哪個檔、依據之結局是否確定」為軸逐格列, 不能只列證據種類.
  - 「預設逐位元一致」之範圍外審比我寬: 參數物件之可列舉鍵、回傳物件之鍵、微工作時序都算.新增 opt-in 能力時用不可列舉屬性保持形狀; 寫檔迴圈未啟用新功能時維持同步(不 `await`); 函數外層不要為了分流多包一層 `return await`——改成同步入口直接回傳本體之 Promise(組態錯誤以 `Promise.reject` 交回), 完成時序才與前版同.
  - 複審(terra 第二輪)14 條: 第一輪之修法多是「布林旗標」, 都被找出時間上之洞——`open` 擋不住同一收集器下一次 run 期間舊計時器(改每次 run 一個序號)、遮蔽外層用 `store.run(null)` 會把祖先資訊一起抹掉而讓第三層 regen 通過(改記 `enabledAncestor`)、以 `records.length` 變化判定「這張已記錄」會被等待期間他處之紀錄干擾(改單張標記)、`null` 與 `undefined` 之判定兩處不一致即可繞過守門.教訓: 修「範圍／歸屬」類缺陷要用身分(序號、標記、檔案身分 dev:ino、真實路徑), 不用布林或字串比對.
  - 測試自身之落點也要守: 全為「比對錯誤」之案例清單落預設 `./testPending`, 測試未導至 `test/_tmp` 就在專案根產生檔案且被 `npm pack` 打進包; 於測試檔尾加「專案根 testPending 不得多檔」之守門(變異 M57 證明有效).
- **有變更才改寫(issue #19)**: `KEEP_MAXDIFF=0` 之「完全相同」以 RGBA 逐像素判定, 不以 pixelmatch 計數 0(整張亮度 +1 計數為 0); 寫出者為當次截圖本身, 比對端覆蓋只用於判定.比對端覆蓋要兩端共用就得只有一份——`runBaselineCase` 之 `compareBuf` 同時供比對端與判定; 寫在自訂 `match` 內之覆蓋判定看不到.
- 預設不變之證明: 以 `git archive HEAD` 解出 1.0.10 之 src, 與現行模組以同一組輸入差分(回傳、錯誤訊息、日誌、寫檔、證據檔名與位元組, 凍結 `Date`); 比較時路徑以 JSON 字串比對須先以 `JSON.stringify(路徑).slice(1,-1)` 取跳脫後之形式(Windows 反斜線), 否則正規化不生效.

## 注意事項: 等待與輸入

- Playwright `waitForFunction` 同步呼叫判斷函數, async 判斷回傳之 Promise 為 truthy → 第一次即放行、逾時無效(抽提時查得 20 處: sso 14、task 6).`waitUntilExist` 偵測到 async 函數即改逐次 `page.evaluate` 輪詢.
- 固定等待以「非同步來源」判, 不以秒數判: 伺服器往返、轉址、計時器、廣播、防抖之後的固定秒數是候選缺陷, 負載高時失敗.頁面內條件用 `waitUntilExist`, 瀏覽器外結果(後端計時器寫庫、背景程序產檔)用 `pollUntil`; 盤點用 `tools/auditWaits.mjs`.spec 規定之時間與負向斷言之觀察窗照留.
- 改偵測前列出原固定等待「順帶」等到的事: 例如原固定等待順帶等過提示浮窗消失, 改偵測後文字一出現就截圖, 會截到尚未消失之浮窗 → 反應目標不是浮窗時, 先等目標再 `waitAlertGone`.
- 以元件庫屬性辨識元件時, 該屬性會隨元件庫新增而被別的元件共用: `waitDrawerReady` 原以裸 `[state]` 認 WDrawer, w-component-vue 2.5.35 讓 WDialog、浮層(`.WPopperFix`)、WListExpandItem、WGroupTags、WGroupDragdrop 之根節點也帶 `state`, 其中 WDialog 與浮層值域(hidden/opening/opened)與 WDrawer 重疊 → 彈窗或提示框開啟中被當抽屜等待(Gitea #35, 2026-11-01).辨識依據一律取**實際渲染之 DOM**(以其 dist 於真 Chromium 掛載後傾印屬性), 不憑讀 `.vue` 模板推測: WDrawer 根節點無固定 class, 唯一獨有者為 `changedrawerwidth` 屬性(`:changeDrawerWidth` 綁定, 2022-04 起), 故預設選擇器 `[state][changedrawerwidth]`; 該屬性屬元件內部實作, 失效時靜默放行, 故提供 `opt.selector`(使用端可立即改傳, 不必等套件升版)並附複驗工具 `test/tools/probeWDrawerDom.mjs`(預設選擇器須只命中 1 個 `w-drawer`).套件測試的 WDrawer 夾具須帶此屬性(`e2e-browserPrimitives`、`e2e-captureEquivalence` 之舊夾具為裸 `state`, 已補); `e2e-captureEquivalence` 內 `ssoWaitDrawerReady` 為使用端現行實作之凍結複本(仍是裸 `[state]`), 不可改, 只改夾具使兩者皆命中.
- **函數 `opt` 之非預期輸入依 dspec〈輸入參數之檢測機制〉K3 處理(2026-11-01 pte35b, 以 `waitDrawerReady` 為首例)**: opt 給了而不屬該鍵種類者視為未給、改用預設, 不拋錯(報錯只用於必須參數); `opt.debug:true` 才警告(固定詞彙、不含傳入之值、同鍵同因每行程一次、出口 `opt.funLog` 否則 `console.warn`); `opt` 為 null 或非一般物件整份視為 `{}`.實測教訓: ①**交給 Playwright 的值要先檢**——`waitForFunction` 的 `timeout` 給數字字串等同未給(等 30 秒預設)、給 0 永不逾時(卡死)、給 -1 立即放行, 皆靜默; 逾時毫秒用 wsemi `isenum(v, { gt: 0, max: 2147483647 })` 判定並以 `Number(v)` 轉換後使用(K4); ②**`'[state'` 缺右括號依 CSS 規格於結尾自動補全而合法**, 測無法解析之選擇器要用 `'##bad'`、`'[[x'`、`'div >'`; ③wsemi 之 opt 解析(`_numOpt.mjs`)為內部檔不由入口匯出, 本套件暫自帶最小實作(`parseOpt`／`emit`), 待 wsemi 公開後收編; ④本套件其他函數之 opt(尤其 `timeout`)尚未依 K3 檢視, 例如 `waitColResizeOverlay` 以 `Date.now() + t` 計期限, 傳字串會變字串串接(未實測, 需實測確認).
- `typeIntoInput` 為 Pattern D: 驗焦點落在元素(防父層 `mousedown.prevent` 靜默漏字) → End＋Backspace 清空 → `insertText` 一次注入 → 驗值, 重試 3 次.已知不對稱: `typeIntoInput` 於可見後固定等 1000ms, `typeIntoNthInput` 無; 屬四專案凍結之時序, 無已觀察之失敗, 勿任意對齊.

## 注意事項: 生命週期與行程

- exit／訊號處理器內之非同步不會被等待 → `cleanup` 須同步(同步 `taskkill`).spawn 之子行程拖住事件迴圈, `exit` 事件要等迴圈清空 → 框架環境由 root after 主動收尾, 直跑則主函式末尾顯式呼叫 `cleanup()`, exit／訊號為備援.
- `registerCleanupHooks` 須於共用層模組頂層呼叫: 使 root after 排在 api 測試層強制退出之前.
- SIGINT 於 Windows 無法由外部送 console 事件, 只能以單元測試(注入假 process)覆蓋.
- 沿用政策之前提: 該 port 專屬本專案.沿用時無法確認對方跑的是哪份設定與版本(與開發服務共用 port 時尤其); `probeHttp` 之 `identify` 可驗專案識別, 但四專案皆尚未提供識別端點.
- 就緒判定只看 HTTP 回應; 服務遇 EADDRINUSE 不一定退出(w-web-task 實測), 沿用政策察覺不到綁定失敗(own 政策才偵測).
- `restart` 殺自建後等 port 釋放(上限 `portReleaseTimeoutMs`)再 spawn; 殺後仍被佔或無自建而被佔時, `killForeignOnRestart:true` 才殺監聽者——**只可用於專案專屬且於映射表明文登錄之 port**.
- 所有權原語與 port 政策原語分區: 所有權規則「絕不以 port 監聽者比對殺行程」, 只殺自建且仍存活者(已結束者之 PID 可能已被回收給無關行程); port 政策原語才殺監聽者.
- `netstat -ano` 不可加 `-p TCP`(只列 IPv4, 漏掉以 `::` 雙堆疊監聽者); 部分語系之 Windows 在地化狀態字, 故判監聽不依狀態欄(以外部位址為萬用位址判); POSIX `lsof` 以 exit 1 表示無人; 查詢工具不可用回 null, 呼叫端不得當成無人.**(2026-10-30 起此判定與解析全部委由 wsemi `execProcessPortPidsSync`, 見下條.)**
- **Windows 11 26300(＋KB5127936)之 netstat 不可信(2026-10-30 e2e01)**: 系統回報 TCP 狀態值錯誤——`netstat -ano` 會整列漏列新起之監聽(本機自起之 0.0.0.0 監聽 0/10 次列出; 修前碼 `listenerPids` 連續 5 次查詢前 3 次回 `[]`, 之後才查到)、對外連線之狀態反列 LISTENING(修前碼 `parseListenerPids` 因「狀態為 LISTENING」之或條件把它判為監聽, `killPortListeners` 照殺不相干之 PID)、系統監聽(135)之狀態字錯為 FIN_WAIT_1.故「誰在監聽某埠」不可單靠 netstat 文字: 一律用 `listenerPids`(wsemi: Windows 先 netstat, 查無或失敗再 `Get-NetTCPConnection -LocalPort`, 其查無才判無人), `[]` 只代表已確認無人, `null` 為失敗; 殺行程與身分確認要完整集合, 傳 `useBoth: true`(`killPortListeners` 內建).代價: 新起之監聽與無人之埠每次約 1 秒(走 PowerShell), exit／signal 處理器內傳較短 `timeout`.
- **`listenerPids`／`killPortListeners` 之 `opt.exec` 為 spawnSync 形(2026-10-30)**: `(prog, args, { src, timeout, maxBuffer }) => { status, stdout, error }`, 以 `src` 分派固定輸出; `killPortListeners` 之 `exec` 查詢與下殺共用(`src`: netstat／powershell／lsof／taskkill／kill, 非 Windows 之下殺為 `sh -c 'kill -9 "$1"'`, 因 `kill` 指令檔不一定存在而內建指令一定在).PowerShell 固定輸出之格式屬 wsemi 內部(標記行與 `R <埠> <遠端位址> <遠端埠> <PID>` 列), 集中於 `test/tools/portPidsFake.mjs` 一處, wsemi 改版時只改該處.`killOwnTree` 之 `opt.exec` 仍為 execSync 形(未改).
- **變異測試不可讓夾具之假 PID 走到真實下殺**: 夾具用 15816、16000、321 等假 PID, 若變異讓 `killPortListeners` 不用注入之 `exec`(用預設 `spawnSync`), 會以真實 `taskkill` 殺本機上恰好同號之行程; 此類變異不做(變異腳本檔內註明).預設執行函數之選項改以「真實子程序案 + 透傳攔截 `cp.spawnSync`(`syncBuiltinESMExports()` 使具名匯入看到替換)」驗, 不靠假 PID.
- 真實案之固定埠: `unit-procPrimitives` 用 19050(真實監聽)與 19051(真實子程序監聽), `unit-portOffset` 用 19030/18930; 新增真實案避開這些埠.
- `beforeSpawn` 做「服務啟動前必須完成」之前置(api 首次 build、perm 重建資料庫與 reseed); 沿用時不呼叫.
- 臨時設定落 `test/_tmp/`(`createTempSettings` 之 tmpDir 必填), 絕不可落 `./tmp`(AI 暫存區隨時被清, 後端讀不到設定即假失敗); `forbiddenKeys` 防覆寫測試實例固定之 port 與 log 目錄.
- **Windows 經 shell 之 spawn 會重新解析參數**(2026-09-30 實測, cmd.exe＋.cmd 批次檔兩層, 同 npx): `|` `&` 切出另一指令(`'E2E-0(0[2-9]|1[0-5])-'` → exit 255「'1[0-5])-' 不是內部或外部命令」)、`<` `>` 轉向(`>` 把輸出寫成 cwd 下之檔案且 exit 0)、`^` 與 `"` 被吃掉、空白拆成多個參數、已定義之 `%名稱%` 展開(皆 exit 0, 靜默改變篩選); 括號、`[ ]`、`!` `,` `;` `=` `*` `?` `\`、中文原樣傳遞; Node 24 另警告 DEP0190.`runIsolatedE2e` 因此於有本地 mocha 時以 `process.execPath` 直接執行 `mocha.js`(`shell:false`), npx 退路於 Windows 遇上述字元即於執行前拋錯.先前文件稱 `(` `)` 也會被當成語法, 實測不成立, 已更正.
- **spawn 之路徑以 `path.resolve(projRoot, …)` 組**: spawn 之 cwd 為 projRoot, `path.join(projRoot, 相對)` 在 projRoot 本身為相對路徑時仍是相對路徑, 子行程內會再疊一次.
- **明確給定之選項若會無效或被改寫, 拋錯而不靜默退回**: `mochaBin` 給了卻不存在時若默默改用 npx, 使用者以為用的是指定版本; npx 退路之參數改寫同理.
- **埠位移(2026-10-28, issue #19)**: 套件內組埠處只有 `createServiceManager`(盤點: `Grep "port|url|baseUrl" src`); `probeHttp`／`killPortListeners`／`listenerPids` 收完整網址或埠, 在其內再加位移會與呼叫端以 `resolveE2ePort` 組成者重複相加, 故不加.字串 url 之埠不等於基準埠時拋錯——不位移就會探測到他實例而「沿用」之.未位移時 `resolveE2ePort` 原樣回傳(不轉型), `createServiceManager` 之服務物件鍵序維持 `{readyTimeoutMs,url,...s}`(先建物件再指定 `url`/`port`), 自訂 probe 收到之物件與 1.0.10 逐位元相同.

## 注意事項: 套件維護與驗證(2026-09-29, 移入)

- `test/e2e-captureEquivalence.test.mjs` 含 w-web-sso／w-web-perm 當時實作之凍結複本(逐位元等價之對照組)與框幾何專測, 屬行為契約, 勿因「看起來重複」刪除; 凍結區段以 `eslint-disable` 保持逐字.
- 測試暫存一律 `./test/_tmp/<受測對象>`, 於 `after` 刪除.
- 文件會隨程式改版漂移: 移入時原 README 有 6 處與程式或現況不符(4 處敘述錯, 例: `smilRectBasis` 寫預設 `'page'` 實為 `'auto'`、`<img>` 動畫區寫遮黑實為靜態影格; 1 處漏記環境變數; 1 處採用範例過時).初查漏看 1 處, 以實體帳冊(抽出文件所有反引號實體逐一 grep)＋逐句對照程式才補齊.改文件以程式為準.
- 抽提期最終版之驗證紀錄未含 lint(09-27 那輪 lint 為 0), 移入時查出 3 個移入檔有 lint 錯誤; 驗證清單須含 lint.無單元測試之 CLI(auditBoxes)做排版修正後, 以真實資料跑修正前後兩版比對輸出, 證明行為不變.
- 審查意見互相矛盾時以原始碼裁決, 不以多數決(抽提期三方審查: perm 之 restartBackend 是否無條件等 port, 原始碼證實只在 port 仍有回應時才等, 一對二).
- 全域技能 role-coder-for-test-e2e 之契約(references/e2e-setup-contract.md §0.5 模組對照與 C6–C13 片段)描述本套件之行為; 改動行為或預設值後同步更新技能, 否則技能與套件再度失真(2026-09-28 曾回頭修 8 處失真, 例: 分隔條選擇器、遮罩量測時點、`<img>` 動畫區座標系).
- 版本現況: 套件 lockfile 為 playwright 1.63.0、sharp 0.35.3; 四使用端(2026-09-28)為 playwright 1.62.1、sharp 0.35.3; 全新安裝(2026-09-29)解析 playwright 1.63.0、sharp 0.35.5.使用端切換時只升本套件, 不順手升 playwright: Chromium 改版可能使標準圖全面變動, 須另依等價驗證評估.
- 使用端視角驗收作法: `npm pack` 後安裝至 `./tmp` 下之假專案, 自 `node_modules` 深層引用實跑; 瀏覽器下載以 `PLAYWRIGHT_BROWSERS_PATH` 導至暫存目錄, 不污染全域快取.
- 工具陷阱: 同一行程勿同時載入兩版 sharp(原生 DLL 同名, 可能共用已載入者), 版本對照實驗分行程跑; sharp 之 `exports` 未開放 `./package.json`, 取版本改讀檔; GNU tar 把 `C:` 當遠端主機, 需 `--force-local`; Windows 版 `sha256sum` 輸出之路徑前綴 `*`.
- **使用端建議文件之主張須逐條實測**(2026-09-30): 同一份建議中事實可屬實(提示框殘留、Windows 管線、日誌不足), 定性卻可能過重(「壓字」實為 3–4px)或論據不全(只提 `|` 與括號, 實則括號無害, 而 `^` `>` 空白 `%名稱%` 會靜默改寫); 採納前以像素量測、元件與 Playwright 安裝版原始碼、最小實驗逐條查證, 處理流程見 `sgud/proc/process.md`.

## 使用端依賴之選項(改預設值前須顧及; 2026-09-28 紀錄, beforeShots 列 2026-09-30 複驗, 其餘未逐專案複驗)

| 面向 | sso | perm | api | task |
|---|---|---|---|---|
| settle | `[waitColResizeOverlay, waitDrawerReady]` | 同 | 同 | 同 |
| beforeShots | `[probeStuckTooltip]` | `[probeStuckTooltip, resetAgGridScroll]` | `[probeStuckTooltip]` | `[probeStuckTooltip, resetAgGridScroll]` |
| strict 來源 | `E2E_STRICT_CAPTURE` | 同 | `strictDefault: () => REGEN` | `E2E_STRICT_CAPTURE` |
| 紅框夾邊 | 預設(buffer、有過小守門) | `clampTo:'viewport'`、`guardSmall:false` | 同 sso | 同 perm |
| rowBoxSel | 預設 | `order:['center','pinned-left']` | — | 同 perm |
| waitUntilExist 逾時 | 預設 10000 | 15000 | 15000 | 15000 |
| 產製入口 | 直跑 `--baseline` | 直跑 | mocha REGEN | 直跑 |
| 生命週期 | reuse、`killForeignOnRestart` | reuse、`beforeSpawn` 種子／reseed、探測 status<500 | reuse、`beforeSpawn` 首次 build | 專案自有 own(行程原語改用本套件) |

註: beforeShots 列之 `probeStuckTooltip` 目前為各專案 e2e-setup 之本地版(1.0.2 無此函數), 由 captureStable 包裝恆置首位; 呼叫端給 `beforeShots` 時只取代其後之預設.

## 待辦與後續

- **使用端切換(已完成; 2026-09-30 複驗)**: 四專案 `test/tools/e2eLib.mjs` 前綴皆為 `'w-package-tools-e2e/src/'`(安裝 1.0.2); w-web-sso 之 `srcPack/` 已移除; 四專案內 `srcPack` 字樣只剩沿革註解與 sso ADR-071／072 之歷史紀錄, 無可執行之 `srcPack/tools` 指令; 全域技能已無 srcPack 字樣.原步驟④(以 `snapshotBaselines`／`diffBaselineSnapshots` 確認標準圖不變)之實跑紀錄在各專案, 未於本套件端複驗.
- **1.0.3 發布後之使用端步驟**(該批變更自 1.0.3 起, 2026-09-30 發布; 2026-10-01 以 npm tarball 查證 1.0.3／1.0.4／1.0.5 皆含、1.0.2 無; npm latest 1.0.5): ①升本套件並確認實裝版本, 不連帶升 playwright——**已完成**(2026-10-01 查: 四專案安裝與宣告皆 1.0.3) ②`e2eLib.mjs` 加匯出 `probeStuckTooltip`, e2e-setup 本地版改為委派套件版(經 `createError` 帶專案訊息)——**已完成**(四專案 e2eLib 皆已匯出, e2e-setup 之同名函數改呼叫 `pkgProbeStuckTooltip`) ③跑比對端: 預期只有空表截圖失敗(建議文件列 sso adduser E2E-009-2、deleteuser E2E-005-2、perm targets E2E-009-2, 各兩語系共 6 張; 以實跑之失敗清單為準, 多階段案例以 `compareAll:true` 才列得全), 取得授權後以 `--write-mode changed` 重產並逐張審, 其餘圖須不變——未於本套件端查證 ④`run-e2e-isolated` 可改用 `targets` 只重跑受影響案例; api 自寫之 runner 可改用套件版——未查證 ⑤全域技能同步——**已完成**(SKILL.md 提示框殘留列與 contract §0.5 之 C6／C7／C13／驗證列於 2026-09-30 12:39 已改為 1.0.3 起; 2026-10-01 補: SKILL.md §7.4 量測型目標之空表訊息外擴、§9.2 逐檔 runner 之 `targets`、contract C7 原留白 3–4px 之更正、驗證列之 npx 退路守門與 `mochaBin`).
- **後續候選(未納入)**: own 政策、`ensureRefImage`(參考片段自舉, 須連帶涵蓋 outDir)、`waitMutationSettled`、openApp／setLang、typeIntoCell、SVG path 定位、遮罩遮擋判定(SKILL §8.2)、跨行程互斥、echarts 圖例讀取器(perm `readStaLegend`).
- **已知缺口(未修)**: `README.md` 既有之 Documentation 連結(github.io)回 404.(原列之 `src/WPackageToolsE2e.mjs` 範本檔 lint 錯誤, 已於 2026-09-29 補齊共用入口時一併消除.)

## 抽提與移入紀錄(摘要)

- 2026-09-27～28: 四專案 e2e 共用層各一份(sso 848 行、perm 1081、api 711、task 522＋harness 736), 同一契約之四個變體已漂移(啟動旗標、strict、紅框畫法、cleanup 同步性、篩選語意、產製端斷言各異), 抽提至 w-web-sso 之 `srcPack/`; 經三方審查定案, 四專案經各自橋接實跑全綠(srcPack 167/167、sso 276/276、perm 162/162、api 71/71、task 26/26), `./testPending/` 零新增.
- 2026-09-29: 移入本套件——`src/` 51 模組(48 檔逐位元相同, 3 檔只改註解或同值字面)、`tools/` 2、`test/` 13(刪轉接檔 1 案); 移入後 `npm test` 184 passing, 使用端(tarball)驗收 14/14.同日三份設計文件抽提至本檔後刪除.
- 2026-10-20: 依 Gitea issue #4／#5(cgsmdb 提出)增已知缺陷之部分截圖(`createKnownDefect` 之 `shots`、`runBaselineCase` 之 `defectStages`)與 gate 之 `noteKnownDefect`／`finalize` 摘要(細節見上與 `sgud/rule/rulebook.md`).
- 2026-09-30: 依使用端建議文件(`建議w-package-tools-e2e調整.md`)增 `probeStuckTooltip`、`gridContentBox` 之 `noRowsPad`、`runBaselineCase` 之 `[write]` 日誌、`runIsolatedE2e` 之 `targets`／node 直接執行／`mochaBin`; 另補 `mochaBin` 路徑解析與拋錯、npx 退路之參數守門.`npm test` 201 passing、lint 0; `probeStuckTooltip` 真元件驗收 6/6; `runIsolatedE2e` 以相對 projRoot 與含 `|` 之 grep 實跑(命中 2 案 exit 0; 對不到任何案例時經 `--fail-zero` 判失敗).
