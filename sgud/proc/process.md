# 重要處理要點

本檔為特有之重要處理要點,為業務端之特化要求事項與處理流程,包含事項、關聯什麼、怎麼判斷與處理方式等,由agent自行編列、擴充與維護.

體例: 每一事項一節, 固定三欄——**關聯**(牽涉哪些檔案／機制／文件)、**判斷**(何時適用、怎麼分辨)、**處理**(照做的步驟與禁止事項).API 細節見 `README.md` 與各模組 JSDoc; 取捨緣由與殷鑑見 `sgud/exp/experience.md`.

## `./tools` 盤點 CLI 之共同規則(重要)

- **關聯**: `tools/auditBoxes.mjs`(標準圖紅框盤點)、`tools/auditWaits.mjs`(固定等待盤點); `README.md` §1.4; `test/unit-auditWaits.test.mjs`.另有 `tools/reviewPending.mjs`(審查與採用, 給 `--accept` 時會寫標準圖), 規則見下文專節.
- **判斷**: 兩支皆為唯讀盤點工具——只讀 PNG 或測試碼, 除 `--out`／`--json` 指定之輸出檔外不寫任何檔.輸出之旗標只是**候選**, 缺陷與否須逐項判讀.**離開碼 0 只代表跑完, 不代表沒有缺陷**(有旗標時照樣是 0), 以統計行判定; 未給目錄時印用法並以 2 結束.
- **處理**:
  - 執行位置: 使用端於其專案根執行 `node node_modules/w-package-tools-e2e/tools/<名>.mjs …`; 本套件內為 `node tools/<名>.mjs …`.用法訊息印實際執行路徑.
  - 於被盤點之專案根執行: auditBoxes 之清單路徑相對 cwd, 自他處執行會印出冗長之 `..\..\…` 路徑; auditWaits 之清單路徑相對各專案根.
  - JSON 輸出一律落 `./tmp/`(例: `--out ./tmp/boxes.json`), 不寫進 `test/pics`、`test/` 或專案根.盤點他專案之資料只讀不寫.
  - 判讀出之缺陷回源頭修(量測 helper、等待寫法), 不放寬工具判準遷就; 修正後以同一指令重跑, 比對各類計數之增減.

## 標準圖紅框盤點: `tools/auditBoxes.mjs`(重要)

- **關聯**: 全域技能 role-coder-for-test-e2e §7.3、§7.6-3、§8.2; `captureStableWithBox`、`itemsUnionBox`、`inkRect`、`gridContentBox`、`canvasInkRects`、`composeBox`; 使用端 `test/pics/<flow>/`.
- **判斷**: 何時跑——①產製或重產標準圖之後、交審之前(技能 §7.6 之無框掃描); ②改動框幾何或量測 helper 之後, 對受影響使用端之 `test/pics` 跑改動前後兩次比對計數; ③審圖發現一張有問題時, 用它把同類全找出來(退一張退一類); ④宣稱「每張都有框」之前——有無框只能以像素掃描證明, 不能以讀碼或呼叫了哪個函數判定.
- **處理**:
  - 指令: `node node_modules/w-package-tools-e2e/tools/auditBoxes.mjs [--out ./tmp/boxes.json] test/pics`; 可給多個目錄, 遞迴掃 `.png`, 略過 `_` 開頭之參考片.
  - 輸出: 首行統計 `scanned=N noBox=… fullFrame=… blank=… black=… touch=… cut=…`, 其下逐類 `[類] 路徑 細節`; `--out` 另寫每張之 JSON(`file,width,height,noBox,redRun,box,fullFrame,blank,black,touch,cut`).
  - 六類判讀:

    | 類 | 判準 | 判讀與處置 |
    |---|---|---|
    | noBox | 橫向或縱向任一方向之 #f26(容差)最長連續紅線 < 20px | **必須為 0**(技能 §7.1 每張都要有框); 有者查目標為何量不到(常見: `[style*="…"]` 選擇器因瀏覽器序列化加空格而永不命中), 修後重產 |
    | fullFrame | 框寬 ≥ 圖寬 95% 且框高 ≥ 圖高 85% | 框了等於沒指出東西, 多為缺陷; 反應本身即全畫面者(已最大化之彈窗)合規 |
    | blank | 框內(內縮 10px, 扁框垂直內縮 7px)底部連續空白 ≥ 120px 且 ≥ 30%, 或右側 ≥ 200px 且 ≥ 30% | 框進整區空白(§7.3-2) → 改 `itemsUnionBox`／`gridContentBox`; 彈窗／抽屜面板內之留白、整列框屬合規 |
    | black | 12×12 純黑實心方塊與框重疊 | 手冊用圖不填黑(§8.2) → 改靜態影格或貼圖覆蓋; 刻意之遮蔽(如信件檢視器之密碼黑條)屬合規 |
    | touch | 框內緣往內 ≤ 2px 即有稀疏字形墨跡(佔比 2%–60%、最長連續段 ≤ 24px 且 < 邊長 25%; 貼圖邊者不計) | 紅框壓字(§7.3-8) → 無可見邊界之目標改 `itemsUnionBox(…, { fit: true })`, canvas 改 `inkRect`; 彈窗面板頂、晶片、圓形按鈕貼框屬元素邊界, 非壓字 |
    | cut | 框線外緣往外 1–2px 內即有稀疏字形墨跡 | 框線壓到框外相鄰內容(§7.3-9) → `fit` 之鄰項／浮層夾邊、`inkRect` 之 `neighbors`; 有遮罩彈窗之框外背景屬合規 |

  - 圖中找不到 #f26 純色像素者不評其餘五類: 先把 noBox 清到 0, 其餘計數才完整.
  - touch／cut／blank 一律裁框放大目視後才下判定; 判為缺陷者回量測 helper 修正, 取得授權後只重產受影響者(技能 §7.9), 再重跑本工具確認該類計數下降且未新增他類.

## 固定等待盤點: `tools/auditWaits.mjs`(重要)

- **關聯**: 全域技能 role-coder-for-test-e2e §4.4、§8.1; `waitUntilExist`、`pollUntil`、`waitAlertGone`、`waitGridIdle`; 使用端 `test/*.test.mjs` 與 `test/tools/*.mjs`.
- **判斷**: 何時跑——①新寫或修改 e2e 測試與共用層之後; ②查 flake(「單跑都綠、並行或負載高時失敗」多為固定秒數當唯一同步); ③宣稱「等待已偵測化」之前.固定等待以「非同步來源」判, 不以秒數判: 秒數門檻會漏掉變數秒數(`waitForTimeout(waitMs)`)與 2–3 秒級者.
- **處理**:
  - 指令(於使用端專案根): `node node_modules/w-package-tools-e2e/tools/auditWaits.mjs [--only C,E,R] [--json ./tmp/waits.json] .`; 可給多個專案根.掃描範圍固定為 `<根>/test/*.test.mjs` 與 `<根>/test/tools/*.mjs`(不遞迴其他子目錄); `//` 開頭之註解行不計.
  - 輸出: 每個根一段——`total N {各類計數}`、各檔分布, 再逐筆 `[類] 檔:行 (秒數)` 附前後語句; `--only` 只篩清單, 統計仍為全部; `--json` 寫全部筆(`root,file,line,dur,cls,prev,next`).
  - 七類判讀:

    | 類 | 意義 | 處置 |
    |---|---|---|
    | A | 前一句為偵測: 偵測後之 settle | 允許 |
    | B | 後一句為偵測: 緩衝後接偵測 | 允許(緩衝本身是否必要另議) |
    | L | 位於輪詢迴圈內: 輪詢間隔 | 允許 |
    | D | 後一句為操作(click、type、goto…) | 多屬允許(Locator 操作自帶可操作性等待) |
    | C | 後一句為截圖／讀取／斷言且前一句非偵測 | 「固定秒數為唯一同步」候選, 逐一判讀 |
    | R | 隨即離開函式 | 同步責任在呼叫端, 查呼叫端 |
    | E | 其他 | 人工判讀 |

  - C／E／R 逐一判讀「前一動作到預期狀態之間有無非同步來源」——伺服器往返、轉址、後端或前端計時器、廣播同步、防抖; 有則改偵測: 頁面內條件用 `waitUntilExist`／`Locator.waitFor`, 瀏覽器外結果(後端計時器寫庫、背景程序產檔)用 `pollUntil`(含伺服器往返者上限給 60 秒級), 提示浮窗用 `waitAlertGone`.
  - 改偵測前先列出原固定等待「順帶」等到的事(轉址、提示浮窗消失、動畫、防抖), 偵測條件寫成終態; 只等目標出現, 會在轉址途中讀取或截到尚未消失之浮窗.
  - 照留: spec 規定之時間(等封鎖到期、觀察期)、負向斷言之觀察窗、偵測後之短暫 settle.
  - 改完重跑本工具確認 C 類下降, 並以受影響 e2e 之 `--grep` 單跑與全跑驗證.

## 修改 `./tools` 之處理

- **關聯**: `tools/auditBoxes.mjs`、`tools/auditWaits.mjs`; `test/unit-auditWaits.test.mjs`(auditBoxes 無單元測試); `README.md` §1.4; 本檔上三節.
- **判斷**: 判準改動會改變各使用端之盤點計數; 純排版或重構須證明輸出不變.
- **處理**:
  - 判準改動: 同步更新檔頭註解之判準說明、`README.md` §1.4 與本檔之判讀表; 以使用端之 `test/pics`(auditWaits 為專案根)實跑新舊兩版, 回報各類計數變化並抽樣目視新增與消失之旗標.
  - 排版或重構: 新舊兩版對同一批真實資料跑 `--out`／`--json`, JSON 與 stdout 須逐位元相同(2026-09-29 auditBoxes 之 lint 修正即以四專案 1054 張證明).
  - 用法訊息須印實際執行路徑(以 `fileURLToPath(import.meta.url)` 相對 cwd 取得), 不可寫死路徑; `unit-auditWaits` 已測此點.
  - 新增 CLI: 放 `tools/`, 以唯讀為原則、輸出檔由參數指定; 補單元測試與 `README.md` 表列, 並於本檔新增一節.

## 新增、改名或移除 `src/` 模組之處理

- **關聯**: 共用入口 `src/WPackageToolsE2e.mjs`(import、物件屬性、JSDoc `@returns` 清單); `test/unit-WPackageToolsE2e.test.mjs`(鍵名清單與順序、匯出對照); `README.md` §1 模組清單、§2.6 環境變數表; 模組自身 JSDoc `@example`(路徑須為 `w-package-tools-e2e/src/<名>.mjs`); 全域技能契約 §0.5 模組對照.
- **判斷**: 共用入口須匯入 `src/` 內其他全部模組(2026-09-29 使用者規定, 仿 w-dispatch-ai 之 `WDispatchAi.mjs`); 單元測試以目錄列舉守門, 漏登錄即失敗.新增模組屬「新增函數」, 不影響使用端既有標準圖; 改名或移除會破壞使用端之橋接與深層引用, 屬不相容變更.
- **處理**:
  - 新增: 模組檔(一檔一個 default export、繁中 JSDoc 附 `@example`、外部副作用可由 opt 注入) → 入口依 README §1 之分組加 import 與屬性, 並補 JSDoc `@returns` 清單 → 單元測試之鍵名清單與匯出對照同步 → `README.md` §1 表列(讀環境變數者另補 §2.6) → `npm test` 與 lint.
  - 改名或移除: 先盤點四使用端之 `test/tools/e2eLib.mjs` 與測試檔之引用, 經業主同意才做; 發版說明列為不相容變更.
  - 可執行腳本(CLI)只放 `tools/`, 不放 `src/`: 入口匯入 `src/` 全部模組, CLI 放進 `src/` 會在引用入口時被執行.

## 改動 `src/` 之驗證範圍

- **關聯**: `package.json` 之 `test`(唯一 script, 全域 §16.5 標準字串); `test/*.test.mjs`; `README.md` §4 等價驗證、§5 改版須知; `sgud/exp/experience.md`「套件身分與相容紀律」.
- **判斷**: 任何 `src/` 改動 → 全套測試與 lint; 改框幾何、截圖序列、啟動旗標或升依賴 → 使用端標準圖會動, 另需發版說明與使用端等價驗證.
- **處理**:
  - `npm test`(2026-09-30 基準: 201 passing, 約 3 分鐘; 首次由 `launchChromium` 下載瀏覽器); 字串固定不得改, 不增設變體; 單檔自編 `npx mocha test/<檔> --timeout 180000`.
  - `npx eslint --ext .mjs src tools test` 須為 0 error(2026-09-29 共用入口補齊後全部檔案為 0).
  - 跑完確認: `test/_tmp/` 無殘留、無 `./testPending/`、無殘留之 chrome-headless-shell 行程.
  - `test/e2e-captureEquivalence.test.mjs` 之凍結複本比對失敗即行為改變, 不得改凍結複本遷就.
  - 使用端視角: `npm pack` 後安裝至 `./tmp` 之假專案, 自 `node_modules` 深層引用實跑(瀏覽器下載以 `PLAYWRIGHT_BROWSERS_PATH` 導至暫存目錄), 驗產物落地.
  - 會動到使用端像素者: 先在使用端以 `E2E_BASELINE_OUT_DIR` 導出重產並以 `compareImageDirs` 量影響範圍, 發版說明明列受影響類別; 使用端重產另須授權.

## 使用端提出之套件調整建議(重要)

- **關聯**: 使用端(w-web-sso／perm／api／task)之 agent 寫給本套件之建議文件(例: 2026-09-30 之 `建議w-package-tools-e2e調整.md`)與其草案副本; 全域 CLAUDE.md §8(審計／審查報告之處置); `tools/auditBoxes.mjs`.
- **判斷**: 建議文件是「主張」, 不是規格.每一條先查證再決定: 草案是否恰為現行版＋所列改動、引用之行號與事實是否屬實、所稱後果是否以實測證成.文件之定性可能過重或過輕(2026-09-30 之 gridContentBox 稱「壓字」, 實測為留白 3–4px), 以實測為準更正後再採納.
- **處理**:
  - 草案範圍: 以 `diff -rq` 與 `diff -u` 比對草案副本與現行 `src/`、`test/`、`tools/`、`package.json`, 確認沒有夾帶未列之改動; 文件內嵌之全文與草案檔逐字比對(副本清除後仍須可照文件套用).
  - 事實主張: 行號對照現行程式; 使用端現況以 Grep 查(四專案 `test/tools/*.mjs`); 元件與 Playwright 之行為讀其安裝版原始碼(`node_modules/w-component-vue/src`、`node_modules/playwright-core/lib`); 像素類主張以 `tools/auditBoxes.mjs` 掃描並裁切放大量測, 不以元素矩形推論.
  - 可執行者: 草案複製到 `./tmp/<名>/`(位於套件內, 模組解析會往上找到套件之 `node_modules`)後 `npm --prefix ./tmp/<名> test` 實跑, 並跑 lint; 行為主張另做最小實驗(例: shell 參數拼接).
  - 依全域 §8 分類(必修／待討論／設計限制／不修)並附證據交使用者裁示; 採納時同類缺口一併補(2026-09-30 另補: `mochaBin` 相對路徑以 `projRoot` 解析、明確給定而不存在即拋錯; npx 退路於 Windows 之參數守門——先以 cmd.exe＋.cmd 兩層之最小實驗量出實際被改寫之字元集, 再定守門範圍, 並更正原文件「括號會被當成語法」之誤).
  - 套用後: 全套 `npm test` 與 lint; 新增之元件相關功能以真元件頁驗收(見下節); 新能力以不注入之真指令實跑; `README.md`、本檔、`sgud/exp/experience.md` 同步, 會動像素者寫入 README 改版須知並列發版說明.
  - 建議文件本身放在套件根目錄且未被 `.gitignore` 排除時, 會隨提交與 `npm pack` 發布; 處理完回報使用者決定去留.

## 收集模式、有變更才改寫、埠位移與審查採用 CLI 之處理(Gitea issue #19)

- **關聯**: `src/createBaselineCollector.mjs`、`src/assertBaselineMatch.mjs`(`opt.collect`)、`src/runBaselineCase.mjs`(`collect`／`keepSame`／`transient`／`compareBuf`)、`src/getE2eMode.mjs`(互斥閘門)、`src/writeBaselineIfChanged.mjs`、`src/resolveE2ePort.mjs`、`src/createServiceManager.mjs`、`src/reviewPendingShots.mjs`、`src/acceptPendingShots.mjs`、`tools/reviewPending.mjs`; `README.md` §2.8～§2.10; 帳本 `sgud/rule/rulebook_baselineRun.md`; 測試 `test/unit-{baselineCollect,keepSame,portOffset,reviewPending}.test.mjs`.
- **判斷**: 三項皆預設關閉, 預設路徑須與 1.0.10 逐位元一致(改這些檔前後皆以差分腳本證明); 彙整錯誤首行為使用端判讀程式之解析對象, 改格式屬破壞性變更; `tools/reviewPending.mjs` 是本套件唯一會寫標準圖之 CLI(只在 `--accept` 明列標籤時).
- **處理**:
  - 改 `assertBaselineMatch`／`runBaselineCase`／`createServiceManager` 之預設路徑: 以 `git archive HEAD` 解出前版 src 至 `./tmp/`, 與現行模組同一組輸入差分(回傳、錯誤訊息、日誌、寫檔、證據檔名與位元組、參數與回傳物件之可列舉鍵、`runBaselineCase` 回傳 Promise 自呼叫至 settle 之微工作數; 凍結 `Date`), 須全同; 新增屬性一律不可列舉(例: spawn 參數之 `port`、管理器之 `portOf`).
  - 採用無案例清單之證據須明示 `legacy:true`(API 限定, CLI 不提供); 測試之證據與案例清單一律導至 `test/_tmp`(全為比對錯誤之案例清單落 `pendingDir`, 未給即專案根 `./testPending`).
  - 改收集或採用之判定: 跑上列四檔並做變異驗證(每個變異於 `./tmp/` 全新副本套用); 新增分支須有對應變異被殺死.
  - `tools/reviewPending.mjs`: 未給 `--accept` 不得寫任何標準圖(`[R06]` 守門); 採用一律先全部驗證再複製; 使用端操作時一律給 `--since <本趟開始時間>`, 先 `--dry-run`.
  - `[P05]` 起真子行程服務於 127.0.0.1:19030(基準 18930＋100), 結束前回驗埠釋放; 兩埠被佔時該條失敗並註明, 不改隨機埠.

## 修改已知缺陷分流(`runBaselineCase`／`createKnownDefect`／gate 缺陷紀錄)之處理

- **關聯**: `src/runBaselineCase.mjs`(整案／部分缺陷分支、`writeShots`／`compareShots`)、`src/createKnownDefect.mjs`、`src/createBaselineGate.mjs`(`noteKnownDefect`、`finalize`); `sgud/rule/rulebook.md` 表 A／表 B(權威); `test/unit-runBaselineCase.test.mjs`、`test/unit-baselineGate.test.mjs`(標題前綴 `[A..]`／`[B..]` 對應列號); `README.md` §2.1、§2.2、§5; 全域技能 role-coder-for-test-e2e §7.5 與 `baseline-as-manual.md` §4.
- **判斷**: 任何動到缺陷分支、stages 檢查、`defectStages`、`noteKnownDefect`、`finalize` 未命中判定之改動. 這些路徑只有假瀏覽器單元測試, 沒有真 Chromium 流程可補位.
- **處理**:
  - 先改規則帳本表 A／表 B(新增或改列), 再改測試(先紅), 再改程式; 測試標題帶列號.
  - 不變式不得破: ①未帶 `shots`、未給 `defectStages` 者行為與 1.0.8 位元級相同(日誌、`out` 欄位集合、`status`、`onKnownDefect` 時序); ②正常路徑之 stages 檢查維持 K=S; ③前段不符不得呼叫 `onKnownDefect`; ④缺陷路徑必過 `semantic`／`verify`; ⑤`finalize` 不放過真正未命中(案例未執行、前段 token 未產、④拼錯).
  - 驗證: 單元之外另以直跑腳本(真 fs／pngjs／pixelmatch／gate, 假瀏覽器)分情境取離開碼(整案缺陷+`--names`、部分缺陷+`--names`、比對前段一致／不符), 並以真 mocha 確認 `this.skip()` 為 pending、前段不符為 failing.
  - 變異驗證: 逐一拿掉三向核對任一向、缺陷路徑不跑 `semantic`、前段比對未過仍呼叫 `onKnownDefect`、`finalize` 不看缺陷紀錄, 測試須轉紅(還原後確認 `git diff` 無殘留).
  - 技能同步: 協定改變時附建議條文給主控(全域技能由使用者統一修改, 不自行改).

## 改動 `itemsUnionBox`（含圖形內容 `graphics`、`graphicAreas`）之處理

- **關聯**: `src/itemsUnionBox.mjs`(頁內函式 `measureEls`:舊規則 `contentAt`/`legacyContentAt`、圖形規則 `graphicAt` 及其 `gUp/gCtxOf/gShapesOf/gCanvasOf`、`nearestOutside` 之圖形掃描、`clampByNeighbors` 之兩套退入規則); `sgud/rule/rulebook.md` §7 表 C(權威); `test/e2e-itemsUnionBoxGraphics.test.mjs`、`test/e2e-captureEquivalence.test.mjs`(舊規則契約); `README.md` §1.1、§2.7、§5; `sgud/exp/experience.md`「注意事項: 紅框」.
- **判斷**: 任何動到 `itemsUnionBox` 之量框幾何、浮層命中、圖形判定、退入規則之改動——**會動使用端標準圖像素**(框幾何類),發版說明必列。這些路徑跑在瀏覽器頁內,只能以真 Chromium 實測,不可讀碼推論。
- **處理**:
  - 先改規則帳本表 C(新增或改格類),再改測試(先對改動前之 src 確認紅),再改程式;測試標題帶格類 ID。
  - 不變式不得破: ①舊規則(`legacyContentAt`)逐字不改、其回非 null 之點結果不變(只增不減); ②`graphics:false` 與改動前逐位元相同; ③無圖形頁面 `elementsFromPoint` 次數不因圖形規則增加(命中堆疊只在幾何上確有圖形時才取); ④圖形只在框線帶(矩形邊外 1 至 `BOX_PAD`,另含緊鄰矩形邊之守距列/行)內介入, 框矩形內(含 inkPad 區)不介入; ⑤對 canvas 來源不呼叫 `getContext`; ⑥小 svg/canvas(寬、高皆 ≤ 480×120)不由圖形規則判定。
  - 驗證: `npm test` 與 `npx eslint --ext .mjs src tools test`; 隨機差分 `node ./tmp/verify/differential.mjs <頁數> <種子> plain|graphics`(固定種子; plain = HTML 文字/晶片/大色塊/小 svg 圖示/小 canvas/遮罩/攔截層, `graphics:true` 對 `false` 及對上一版量框逐位元相同且舊規則確有介入(非空轉); graphics = 另加隨機大 svg/canvas 圖表, `graphics:false` 對 1.0.9 逐位元相同, `graphics:true` 之量框須為 `false` 之子集); 真圖表庫掃描(Highcharts 11、Plotly 2、ECharts 5,以 `npm --prefix ./tmp/libs install` 裝於暫存區,不入套件)之框線帶蓋墨跡數須為 0; 變異驗證(逐一拿掉可見性、底色、裁切、遮蓋、取樣足跡/間距、帶界、canvas 背景與變換防護、退入規則等,測試須轉紅;重複防線之等價變異體須逐一說明)。
  - 探測一律用 `tmp/libs` 之真庫與 `launchBrowser`; `inkUnderFrame`(框線帶內、浮層矩形外之指定色像素數)為「是否蓋到」之量度,不以元素矩形推論。
  - 使用端視角: 發版前以 `E2E_BASELINE_OUT_DIR` + `compareImageDirs` 量使用端(perm stainfor、cgsmdb 等)受影響之圖,逐張審後才重產。

## 升級 w-component-vue 或 Playwright 時之複驗

- **關聯**: `src/probeStuckTooltip.mjs`(依 WTooltip 內部結構: `$refs.divTrigger`／`divContent`、`props.mode`、`data.valueTrans`); `src/waitColResizeOverlay.mjs`、`src/waitDrawerReady.mjs`(依 WDrawer 之 DOM 標記); `launchChromium`／`launchBrowser`(Chromium 版本隨 playwright).
- **判斷**: 元件改寫時, 以結構辨識之函數會「找不到任何東西而一律通過」, 測試不會變紅(套件測試只用模擬結構), 必須以真元件實測.Playwright 版本決定 Chromium 版本與預設啟動參數: 1.62 停用 `BoundaryEventDispatchTracksNodeRemoval`, 1.63 起不停用, 邊界事件(mouseleave 等)語意與截圖像素都可能改變.
- **處理**:
  - w-component-vue 升級: 以使用端 `node_modules` 之 `vue/dist/vue.min.js` 與 `w-component-vue/dist/w-component-vue.umd.js`, 在 `page.setContent` 之頁以 `addScriptTag` 載入並 `Vue.use(window['w-component-vue'])` 掛 WButtonCircle(`tooltip`)、WTooltip(`isolated`)、WPopup(v-model); 驗: 懸停中偵測得到、移開後為空、已開之 WPopup 不誤判、掛進 `captureStable` 之 `beforeShots` 可正常截圖(2026-09-30 以 2.5.24 實測 6/6).WDrawer 之兩個 settle 掛鉤同理以真元件確認標記仍在.
  - Playwright 升級: 屬會動像素之依賴升版, 使用端全量重跑並審差異(README §4 等價驗證); 本套件內以 `npm test` 確認(`launchChromium` 會自動下載新版瀏覽器).

