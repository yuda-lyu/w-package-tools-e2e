# 規則帳本:瀏覽器之啟動(經 w-playwright)

編列依據:排程第 442 項之遷移輪(2026-11-13,pm-pte);w-playwright 之設計報告 §5.1 本套件之列、§5.2;w-playwright 帳本 R-PW-ONLY、R-PW-WIRING.API 與行為變更見 `README.md`〈Installation〉之〈瀏覽器之取得與啟動〉、§1.1 `launchBrowser`、§5 之 2026-11-13 條.

## 1. 規則

### R-LB-1 唯一啟動出口
- `src/launchBrowser.mjs` 為本套件唯一之瀏覽器啟動處:`wpw.launchChromium({ headless: true, autoInstall: true, installDeps: true, ...opt, args: [...base, ...opt.args] })`(`base` 為 `chromiumLaunchArgs` 全部〔2026-11-21 起七項,2026-11-25 起八項,見 R-LB-7〕;呼叫端自給語系時 `base` 去掉其 `--lang`,見 R-LB-6;`wpw` 為 `import wpw from 'w-playwright'` 之預設匯出;`opt.args` 非陣列時忽略;`opt.autoInstall`、`opt.installDeps` 非布林值〔含 `undefined`、`null`〕時改用預設 `true`——dspec〈輸入參數之檢測機制〉K3,否則 `...opt` 之 `undefined` 會使 w-playwright 改用其預設 `false`;外審 terra F1).
- 不提供 `launchChromium`、`launchChromiumCore`(2026-11-13 移除,不保留相容層;w-playwright 設計之約束 3、原則 14).使用端需不帶旗標組之啟動者直接用 `wpw.launchChromium`.
- 旗標組(`src/chromiumLaunchArgs.mjs`:六旗標＋`--lang=zh-TW`〔2026-11-21 起〕＋`--disable-smooth-scrolling`〔2026-11-25 起,R-LB-7〕,共八項)不移入 w-playwright(截圖確定性屬本套件);改動即全量重產(不變;本次之意義見 R-LB-6 與 README §5 之 2026-11-21 條).

### R-LB-2 不直接依賴 playwright／playwright-core(w-playwright 帳本 R-PW-ONLY)
- `package.json` 之 `dependencies`、`devDependencies` 不得有 `playwright`、`playwright-core`;`w-playwright` 列於 `dependencies`(`launchBrowser` 為執行期程式碼).
- `src`、`test`、`tools`、`toolg` 之 `.mjs`／`.js`／`.cjs`(含動態 `import()`、`require`)不得引用 `playwright`／`playwright-core`.
- 盤點指令(命中須為 0;先以 w-playwright 之 `src/_pw.mjs` 確認指令有效,防空集合):

```
rg -n --glob '*.{mjs,js,cjs}' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!tmp/**' "(from\s+|import\(\s*|require\(\s*)['\"\`]playwright(-core)?['\"\`/]" <本套件根>
rg -n --glob '**/package.json' --glob '!**/node_modules/**' "\"playwright(-core)?\"\s*:" <本套件根>
rg -n "(from\s+|import\(\s*|require\(\s*)['\"\`]playwright(-core)?['\"\`/]" <w-playwright 根>/src/_pw.mjs
```

### R-LB-3 接線測試(w-playwright 帳本 R-PW-WIRING)
- 啟動點全集:`rg -n "wpw\.(launchChromium|launchChromiumPersistent)\(" src` 只有 `src/launchBrowser.mjs` 一處.
- `test/api-launchBrowserWiring.test.mjs` 以 `wpw.setBrowserTypeForTest` 斷言替身被呼叫(次數 >0)、收到之合併選項 `args` 末元素為唯一之 `--disable-features` 且含 `AutofillAiWalletPrivatePasses`;以包住 `wpw.launchChromium` 之 spy 斷言送出之原始選項(`headless`、`autoInstall`、`installDeps`、六旗標＋`opt.args`).
- 真路徑兩案:`[LB04]` 替身以 `next()` 真啟動 headless shell(頁面可用);`[LB07]` 子行程內**不掛替身**經 `launchBrowser` 真啟動,以 `DEBUG=pw:browser` 收 Playwright 之 `<launching>` 紀錄驗實際命令列(執行檔為 headless shell;恰一個 `--disable-features`,集合＝Playwright 預設∪守門;六旗標皆在).CDP `Browser.getBrowserCommandLine`(headless shell 回「--enable-automation not set」)與 Playwright 之 `logger` 選項(收不到 `<launching>`)皆不可用(2026-11-13 實測).
- 變異:`launchBrowser` 改回不經 wpw 之寫法(直呼 playwright-core 之 `chromium.launch`)時,除不涉啟動之 `[LB00]`、`[LB07b]` 外全數須轉紅;其餘變異(刪 `autoInstall`／`installDeps` 之預設或非布林正規化、正規化只認 null、漏 `headless`、`...opt` 置前、漏附 `opt.args`、`opt.args` 置於六旗標前)各有案例轉紅(pm-pte 10 個全數擊殺).
- **變異之安全程序**(必守;外審 terra F11):「不經 wpw」之變異體屬未經 w-playwright 之啟動,不得真的啟動任何瀏覽器.執行該變異體時須設 `PLAYWRIGHT_BROWSERS_PATH` 為**空目錄**(直呼路徑缺檔即 reject、且不自動安裝;`[LB07]` 之子行程繼承此環境),事後回驗該目錄仍為空;不得以 `SELENIUM_REMOTE_URL` 代替(`[LB07]` 之子行程會刪除此變數).變異一律在 `./tmp/` 之副本上植入(`src/launchBrowser.mjs`、`src/chromiumLaunchArgs.mjs`、本測試檔與 `test/tools/launchBrowserCmdline.mjs`),不改 repo;仍經 wpw 之變異體照常執行(只起 headless shell).修前版本(舊 `launchChromium` 會自動安裝)不可用空目錄法,其對照只跑不啟動之案例或以 `SELENIUM_REMOTE_URL` 使之連線失敗.

### R-LB-4 行為變更之守門(README §5 2026-11-13 條)
- 錯誤為 w-playwright 之固定詞彙錯誤(帶 `code`,不附原錯誤):`[LB05]`(`E_LAUNCH`、`E_BROWSER_MISSING`).
- `SELENIUM_REMOTE_URL` 有值即 `E_ENV`、不啟動:`[LB06]`.
- `opt.args` 含無效元素時整個 `args`(含六旗標)視為 `[]`、只留守門之一串:`[LB03]`.
- 呼叫端之 `--enable-features` 另合併為唯一一串,守門功能與被呼叫端停用之項剔除:`[LB02c]`.
- `opt` 之有效鍵(`headless`、`channel`、`executablePath`、布林之 `autoInstall`／`installDeps`、`timeout`)原樣送出:`[LB02d]`(spy 不轉呼叫 w-playwright);非布林之 `autoInstall`／`installDeps` 用預設 `true`:`[LB08]`;`installTimeout` 與自用鍵 `debug`／`funLog`／`onTrace` 原樣送出、未給不帶、不轉傳給 BrowserType:`[LB13]`(R-LB-8).
- 旗標組之內容(六旗標原序＋`--lang=zh-TW`)以測試內之獨立契約值比對(`[LB00]`),不以受測陣列自比.
- `opt.args` 含無效元素時整個 `args`(含旗標組之 `--lang=zh-TW`)被捨棄,w-playwright 改補主機語系:`[LB03]`(模擬主機語系 de-DE).

### R-LB-5 測試之啟動紀律
- 本套件之測試只啟動 headless shell(無頭、未給通道);不得啟動真 Chrome、Edge、完整 Chromium.每個 e2e 檔以 `before` 起一個瀏覽器、`after` 關,案例各開 context/page;`before` 起瀏覽器者掛 `this.timeout(LAUNCH_HOOK_TIMEOUT_MS)`(R-LB-8,`[LH06]` 盤點守門).
- 本套件無「以真啟動探測可用性」或「改寫 `chromium.launch`」之測試(2026-11-13 盤點:`rg -n "channel|headless:\s*false|chromium\." test` 無啟動用之命中);新增時依 w-playwright 設計 §5.2 改用 `findSystemChrome`／`setBrowserTypeForTest`.

### R-LB-6 語系旗標 `--lang=zh-TW`(排程第 585 項,2026-11-21;使用者裁示「甲」)
- 背景:Chromium 159(headless shell revision 1255)不再繼承主機系統語系,應用程式語系預設 en-US(156 繼承);generic 字族與 CJK 後備字型隨語系而定(Windows 繁中主機:拉丁字微軟正黑體 → Arial、中文字微軟正黑體 → Microsoft YaHei,14px 行高 19 → 16);context `locale` 只改 `navigator.language`、不改字型.w-playwright 1.0.3 於呼叫端 args 無語系開關時補主機系統語系,結果仍隨主機而變,故由本套件之旗標組固定.
- 規則(唯一實作 `src/launchBrowser.mjs`:`isLangSwitch`、`isLangStr`、`callerLang`):

| # | 規則 | 測試 |
|---|---|---|
| 01 | `chromiumLaunchArgs` 為七項(2026-11-25 起增為八項,末尾加 `--disable-smooth-scrolling`,見 R-LB-7;前七項不變):六旗標原序在前、`--lang=zh-TW` 第七;凍結;語系開關恰一個;其餘六旗標與順序不變 | `[LB00]`(獨立契約值 `SEVEN`、`FULL`)、`e2e-browserPrimitives` |
| 02 | 預設(呼叫端未自給語系):送出之 args 為旗標組(七項,R-LB-7 後八項)＋`opt.args`;w-playwright 見 args 已有語系開關即不補,命令列之語系開關恰一個且為 `--lang=zh-TW`,不隨主機語系 | `[LB01]`、`[LB02b]`、`[LB07]`(真命令列,模擬主機語系 en-US)、`e2e-launchBrowserLang` `[LL01]`、`[LL02]`(模擬主機 zh-TW、en-US、ja-JP、de-DE,結果逐項相同) |
| 03 | 呼叫端自給語系:`opt.args` 含語系開關(辨識同 w-playwright:去前置 `-`、不分大小寫、取 `=` 之前為 `lang`;`--lang=…`、`-lang=…`、`--LANG=…`、`--lang`、`--lang=` 皆算),或 `opt.lang` 為 `false`、或 `opt.lang` 為有效語系字串(2～3 字母語言碼加以 `-` 相接之 1～8 字英數子標籤,總長 ≤ 35)時,**不帶旗標組之 `--lang`**,最終命令列之語系開關恰為呼叫端所給者;六旗標原序在前、呼叫端 args 緊隨其後 | `[LB09]`(9 種寫法含 `--lang=zh-TW` 本身)、`[LB10]`、`[LB11]`、`[LB12]`、`[LB07c]`(真命令列,呼叫端 en-US、模擬主機 ja-JP)、`[LL03]`、`[LL04]` |
| 04 | 優先序:`opt.args` 之語系開關優先於 `opt.lang`(w-playwright 忽略 `opt.lang`);`opt.lang:false` 不帶任何 `--lang`;`opt.lang` 無效值(非字串、不合語法、逾長)視為未給,仍用 `zh-TW`;`opt.args` 非陣列時忽略(不算自給);`opt.lang` 之原值照送 w-playwright | `[LB10]`、`[LB11]`、`[LB12]` |
| 05 | 不相近誤判:`--language=`、`--lang-x=`、`--no-lang` 不算語系開關 | `[LB09c]` |
| 06 | 呼叫端給兩個語系開關者原樣保留兩個(w-playwright 之規則,呼叫端自負),不再加第三個 | `[LB09b]` |
| 07 | 不改動呼叫端之 `opt.args` 陣列與凍結之旗標組 | `[LB12]` |
| 08 | 本套件之語法判準與 w-playwright 一致(防漂移):對表列之各 `opt.lang` 字串值(有效 7 個、無效 11 個),w-playwright 補入 `--lang=<值>` 與否＝本套件判為有效與否 | `[LB10]` 內之 `wpwTakes` 斷言 |

- 測試之主機語系不隨執行機器:`test/tools/withHostLang.mjs` 以替身取代 `Intl.DateTimeFormat`(w-playwright 每次合併時才讀、不快取)模擬主機語系(接線案用 de-DE,真命令列用 en-US／ja-JP,真瀏覽器用 zh-TW、en-US、ja-JP、de-DE);否則於繁中主機上「預設行為」與「固定 zh-TW」結果相同而分不出對錯(2026-11-21 首跑修前版本:未模擬時 `[LB07]` 於修前為綠).
- 真瀏覽器實測(`e2e-launchBrowserLang`):`navigator.language`、CDP `CSS.getPlatformFontsForNode` 之 `sans-serif` 實際字型家族(Windows:zh-TW → 中文字與拉丁字皆微軟正黑體;呼叫端 `--lang=en-US` → Microsoft YaHei／Arial;字型斷言限 `win32`,其他平台只驗語言).
- 已知限制:`opt.args` 任一元素無效使整個 `args` 被 w-playwright 捨棄時(R-LB-4),`--lang=zh-TW` 隨旗標組一併失去,w-playwright 改補主機語系(`[LB03]`);未驗真 Chrome、Edge、完整 Chromium、有頭、非 Windows.
- 變異(`./tmp` 副本,2026-11-21;腳本與結果見本輪報告):不去重、辨識只認 `--lang=`、不處理 `opt.lang`、不處理 `false`、`isLangStr` 放寬／無長度上限／允許底線、辨識放寬為前綴、捨棄整個旗標組、語系旗標置首、語系值改 en-US、args 非陣列仍判自給、就地改寫呼叫端陣列、旗標組不含語系(修前);須各有案例轉紅.

### R-LB-7 旗標組加 `--disable-smooth-scrolling`(排程第 636 項 ⑦,2026-11-25;需求出處:使用端回報)
- 背景:使用端 e2e 於「讀到捲動位置後 1～3ms 內按 PageDown」時,Chromium 之鍵盤捲動若為平滑動畫,動畫進行中之按鍵可能被吞(時序競賽,使用端已自行處理);關閉平滑捲動使鍵盤與滾輪之捲動即時到位,結果不依賴預設值與主機作業系統之動畫設定.
- 規則:`chromiumLaunchArgs` 為八項:前七項(六旗標、`--lang=zh-TW`)與順序不變,**`--disable-smooth-scrolling` 附於末尾**(恰一個);`launchBrowser` 呼叫端未自給語系時送出之 args 為八旗標＋`opt.args`;呼叫端自給語系時為「六旗標＋`--disable-smooth-scrolling`＋`opt.args`」(旗標組去語系之七項);呼叫端以 `opt.args` 給 `--enable-smooth-scrolling`(附加於旗標組之後)可開啟.
- 實測(本機 Chromium 159、headless shell):預設即非平滑(Ctrl+End、Ctrl+Home、PageDown、滾輪、`scrollTo({behavior:'smooth'})`、CSS `scroll-behavior:smooth` 皆即時到位,有無本旗標之位置序列相同);加 `--enable-smooth-scrolling` 才出現中間位置(同 `e2e-launchBrowserScroll` 之對照組).故於本機**無行為差異**,標準圖預期 0 改變;旗標之作用是使確定性不依賴預設值與主機設定(使用端環境曾實測動畫為開).
- 測試:`[LB00]`(契約值 `FULL`、順序、恰一個、凍結)、`[LB01]`、`[LB02]`、`[LB02b]`、`[LB02d]`、`[LB07]`(真命令列含該旗標)、`[LB07c]`、`[LB09]`、`[LB09c]`、`[LB10]`、`[LB12]`;`e2e-launchBrowserScroll` `[SS01]`(預設啟動之鍵盤捲動無中間位置)、`[SS02]`(對照組:開啟平滑捲動時量測得到中間位置,證明 `[SS01]` 之量測有鑑別力).**`[SS01]` 於旗標有無下皆綠(本機預設已為非平滑),旗標之存在由 `[LB00]`、`[LB07]` 守住**——不宣稱 `[SS01]` 為此旗標之修前紅.

### R-LB-8 安裝預算與 `before` 時限之轉出、`installTimeout` 之傳遞、本庫測試之 `before` 時限(排程第 636 項 ⑤,2026-11-26;w-playwright 1.0.6〔t636w〕提供 `INSTALL_BUDGET_MS`、`LAUNCH_HOOK_TIMEOUT_MS`、`installTimeout`、`onBrowserCreated`;需求出處:使用端)
- 背景:w-playwright 1.0.6 起 `autoInstall` 之安裝有真實整體上限(`opt.installTimeout`,預設 `INSTALL_BUDGET_MS`＝15 分鐘,0 表不限;兩次安裝共用一個預算),並提供使用端 `before`(內含可能遇首次安裝之啟動)之建議時限 `LAUNCH_HOOK_TIMEOUT_MS`(＝預算＋結束安裝子行程樹之等待 10 秒＋啟動逾時預設 3 分鐘＋餘裕 1 分鐘,約 19.2 分鐘).本庫為使用端之測試啟動出口,轉出兩常數並以其校正本庫測試之 `before` 時限;常數只有 w-playwright 一份(主控已定).
- 規則:

| # | 規則 | 測試 |
|---|---|---|
| 01 | `src/launchBrowser.mjs` 具名匯出 `INSTALL_BUDGET_MS`、`LAUNCH_HOOK_TIMEOUT_MS`,值為 `wpw` 同名屬性(`export const X = wpw.X`);入口 `WPackageToolsE2e` 於 `launchBrowser` 之後增同名兩鍵、同值;兩者為 1～2147483647 之整數毫秒(mocha 時限上限);`LAUNCH_HOOK_TIMEOUT_MS` ＞ `INSTALL_BUDGET_MS` 且 ＞ 180000 | `unit-launchBudget` `[LH01]`、`unit-WPackageToolsE2e` |
| 02 | **不自行定義第二份(不複製字面值、不設備援值)**:靜態——兩個轉出各為單行 `export const X = wpw.X`(行尾無備援 `??`／`\|\|`、無運算),且 `X` 於去註解後之程式碼只出現該行(不另有定義或使用);動態——鏡像證明:把整個 `src/` 複製到 `test/_tmp/` 之暫存夾、其 `node_modules` 放常數為不同值(123456、654321)之假 `w-playwright`,`launchBrowser.mjs` **與主檔 `WPackageToolsE2e`** 之轉出值隨之為假值且啟動呼叫走假套件(靜態規則看不到之複製——如另建 `wpw` 之副本再覆寫常數——由動態證明抓到:變異 M18 只有 `[LH03]` 擊殺、`[LH02]` 單獨存活;主檔寫成字面值之變異 M19 只有 `[LH03]` 擊殺);另一鏡像不放常數,轉出值須為 `undefined`(不得以 `??` 等補一個自有數值,變異 M21) | `[LH02]`、`[LH03]`、`[LH03b]` |
| 03 | `installTimeout` 與 `debug`、`funLog`、`onTrace` 等其餘鍵**原樣**交給 `wpw.launchChromium`(同一物件參照;含 `0`、數字字串、負數、`'abc'`、`null`、`undefined`、`NaN`、`Infinity` 等值;本函數不解讀、不補預設、不改寫、不丟鍵);未給時**不帶該鍵**(預設由 w-playwright 採 `INSTALL_BUDGET_MS`);經 w-playwright 後 `installTimeout`、`autoInstall`、`installDeps`、`debug`、`funLog`、`onTrace` 不轉傳給 BrowserType(為自用鍵,以替身取合併後之選項驗) | `api-launchBrowserWiring` `[LB13]` |
| 04 | **`createCdnLocal` 系列不得依賴 w-playwright**:`createCdnLocal`、`createDirLock`、`loadCdnManifest`、`genCdnManifest`、`tools/genCdnManifest.mjs` **及其相對匯入之閉包**去註解後無 `w-playwright` 之字串(其前後為引號或路徑分隔字元者:import、require、動態 import、`node_modules/w-playwright/…` 路徑皆不可;`w-playwright-xxx` 等相近套件名不算);只改文件與範例(`rulebook_cdn.md` R-CL-16) | `[LH04]`(含閉包走訪與字串判準之鑑別力、防空集合) |
| 05 | **本庫測試中於 `before` 直接啟動瀏覽器者,時限掛 `this.timeout(LAUNCH_HOOK_TIMEOUT_MS)`**(啟動呼叫:`launchBrowser(`、`launchChromium(`、`launchChromiumPersistent(`,可帶接收者如 `wpte.launchBrowser(`、`wpw.launchChromium(`),不沿用 mocha 全域 180 秒或 describe 層之 120／180 秒;現有 7 處(`e2e-browserPrimitives`、`e2e-captureEquivalence` 兩處、`e2e-itemsUnionBoxGraphics`、`e2e-portInImage`、`e2e-probeStuckTooltip`、`e2e-waitDrawerReady`)皆掛;盤點器 `auditLaunchHooks`(`stripComments`／`matchParen` 於 `test/tools/srcScan.mjs`,與 `unit-childProcHide` 共用)只認 `before`(不含 `beforeEach`)、只及 hook 本體內直接呼叫者、`this.timeout(<運算式>)`(可跨行)須在第一個啟動呼叫**之前**且運算式含識別字 `LAUNCH_HOOK_TIMEOUT_MS`(單獨、與 `cdn.hookTimeoutMs`／`CDN_HOOK_TIMEOUT_MS` 相加或取較大者皆可);同一 `before` 另含 `cdn.ensure()` 者之建議值見 06 | `[LH05]`(盤點器鑑別力:未掛／他種時限／單獨相加較大者跨行／註解字串／時限在啟動之後／帶接收者／`beforeEach`／屬性取用／箭頭函數／多 hook 行號)、`[LH06]`(全庫盤點,至少 7 處以防空集合) |
| 06 | **兩常數之關係(同一 `before` 同時含首次瀏覽器安裝與 CDN 取得)**:`cdn.hookTimeoutMs`(未自給 `budgetMs` 等時限者＝`CDN_HOOK_TIMEOUT_MS`,35.5 分;自給者以實例之實際值為準)為 `cdn.ensure()` 最壞時間之建議時限,`LAUNCH_HOOK_TIMEOUT_MS` 為啟動(含首次安裝)最壞時間之建議時限;**串行(先 `await cdn.ensure()` 再啟動)兩段最壞時間相加**,掛 `cdn.hookTimeoutMs + LAUNCH_HOOK_TIMEOUT_MS`(約 54.7 分),取較大者不足(只涵蓋一段為最壞);`Promise.all` 並行者取較大者;分在兩個 `before` 者各掛各自之時限;給 `installTimeout` 者以差額調整(`LAUNCH_HOOK_TIMEOUT_MS − INSTALL_BUDGET_MS ＋ installTimeout`,給 0 即無有限建議值;另給 `timeout` 者再加上它與 Playwright 啟動逾時預設 3 分鐘之差額).本庫測試無「同一 `before` 含 CDN 取得與真瀏覽器啟動」者(`e2e-createCdnLocal` 之 `before` 只對夾具伺服器取得,啟動在 `it`/`beforeEach` 內),故無案可掛;`createCdnLocal` 不內建此常數(不依賴 w-playwright,R-CL-16) | README〈Installation〉第 7 點、`launchBrowser` JSDoc、`rulebook_cdn.md` R-CL-16(文件) |

- 行為變更(README §5 之 2026-11-26 條):`launchBrowser` 預設 `autoInstall: true` 之安裝由無時限改為受 `INSTALL_BUDGET_MS`(15 分鐘)限制,逾時 `E_INSTALL`;w-playwright 之 `ensureChromium` 之 `timeout` 預設由 0 改為 15 分鐘(屬 w-playwright).瀏覽器已備妥者不受影響.真實上限之行為(逾時結束子行程樹、兩次安裝共用預算、並行後到者等鎖)之測試在 w-playwright(`api-installBudget`、`unit-installBudget`),本庫不重複且**不實際下載瀏覽器**(`autoInstall` 之真安裝路徑本庫無測試,與 R-LB-5 一致).
- 已知限制:①`[LH06]` 只及 `before` 內**直接**呼叫 `launchBrowser(` 者;經輔助函數間接啟動者、`beforeEach` 與 `it` 內之啟動(`e2e-readyWaits` 之 `beforeEach`、`e2e-createCdnLocal` 與 `api-launchBrowserWiring` 之 `it`、`e2e-launchBrowserLang`／`e2e-launchBrowserScroll` 之 `it`)不在盤點範圍,沿用 describe 層時限(首次安裝只落在第一個啟動者;本機已備妥瀏覽器)——若使用者要求 `beforeEach`／`it` 亦納入,另派.②`LAUNCH_HOOK_TIMEOUT_MS` 之 `before` 時限為「單一 hook」之上限,hook 內另含其他耗時工作(如 `e2e-portInImage` 之 `before` 另建暫存夾與截圖)須自行加計(現皆為秒級).
- 變異(`./tmp` 鏡像,只複製檔案、無目錄連結,2026-11-26,37 個全數擊殺,另 2 個預期存活之對照,與預期不符 0):常數寫成字面值(`[LH02]`、`[LH03]` 各自單獨皆擊殺)、取錯屬性、備援值 `?? 9e5`(`[LH02]`、`[LH03b]` 各自單獨皆擊殺)、入口少一鍵、主檔寫成字面值(M19:僅 `[LH03]` 之主檔鏡像擊殺,M19a 對照:`unit-WPackageToolsE2e` 與 `[LH01]` 存活)、以計算屬性名改寫 `wpw` 副本(M18:靜態與同值比對皆不抓,僅 `[LH03]` 擊殺,M18a 對照:`[LH01]`、`[LH02]` 存活)、`installTimeout` 丟掉／補預設／丟非數字／轉 Number、自用鍵被丟、`createCdnLocal` 系列五檔各加 `w-playwright` 之 import／require／動態 import／字串／工具腳本、經相對匯入之閉包帶入(M20)、`before` 時限被拿掉／改回 120000／同檔第二處被拿掉、盤點器誤含 `beforeEach`／時限判定恆真／不核對時限在啟動之前／只認 `launchBrowser(`／字串判準不含路徑分隔字元／閉包不走相對匯入／不剝註解、`[CE16c]` 鉤子不掛路由／不還原／持久入口未經鉤子.修前(改前 src)之紅:新測試與 6 個 e2e 檔皆因 import 具名匯出而 LOAD-ERROR;`[LB13]`、`[LH04]`、`[CE16c]` 於修前亦綠(守門測試,以上列變異證其鑑別力);`[LH06]` 於改前之 6 個 e2e 檔(最終 src ＋ 改前測試)為紅,列出 7 處未掛.

## 2. 改動範圍 → 測試檔

| 改動範圍 | 受影響之測試檔 |
|---|---|
| `src/launchBrowser.mjs`(含 R-LB-8 之轉出常數與 `installTimeout` 傳遞)、`src/WPackageToolsE2e.mjs` 之 `INSTALL_BUDGET_MS`／`LAUNCH_HOOK_TIMEOUT_MS` 鍵 | `unit-launchBudget`、`unit-WPackageToolsE2e`、`api-launchBrowserWiring`(`[LB13]`);`before` 啟動瀏覽器之 e2e 檔之時限(`[LH06]`) |
| `src/launchBrowser.mjs`、`src/chromiumLaunchArgs.mjs`、`package.json` 之 w-playwright 版本 | `api-launchBrowserWiring`、全部 e2e 檔(`e2e-browserPrimitives`、`e2e-captureEquivalence`、`e2e-itemsUnionBoxGraphics`、`e2e-launchBrowserLang`、`e2e-launchBrowserScroll`、`e2e-portInImage`、`e2e-probeStuckTooltip`、`e2e-waitDrawerReady`;皆經 `launchBrowser`)、`unit-WPackageToolsE2e`;輔助 `test/tools/withHostLang.mjs`、`test/tools/launchBrowserCmdline.mjs` |
| `src/WPackageToolsE2e.mjs`(入口之鍵) | `unit-WPackageToolsE2e` |
| 截圖、量框、等待類原語 | 對應之 e2e 檔(見 `README.md` §6) |
| 埠、行程、分組多開 | `unit-*`、`api-*` 之對應檔(`rulebook_port.md`、`rulebook_shard.md`) |

## 3. 已知限制

- 依賴樹有兩份 w-playwright 時 `setBrowserTypeForTest` 只作用於測試所引用之一份;`[LB01]` 斷言替身被呼叫以防空過.
- `[LB01]`～`[LB03]` 之 spy 依 `launchBrowser` 於呼叫時以 `wpw.launchChromium` 取函數(屬性查找);改為解構匯入時 spy 失效而轉紅,屬預期之守門.
- 本套件無標準圖;「標準圖不變」對下游為推測(限預設呼叫、未自給功能開關與 `ignoreDefaultArgs`),由全庫連動之比對確認;新舊路徑未做同頁截圖之直接比對(舊路徑屬未經 w-playwright 之啟動).
- 替身與 spy 以 `afterEach` 兜底還原(mocha 逾時不取消進行中之 Promise);`[LB07]` 之子行程逾時以 `taskkill /T` 樹狀結束(非 Windows 只結束子 node 行程).
- `launchBrowser(null)` 於讀 `opt.args` 時拋原生 `TypeError`(與改版前相同,未改;外審 terra F3).
