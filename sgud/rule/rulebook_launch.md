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
- `opt` 之有效鍵(`headless`、`channel`、`executablePath`、布林之 `autoInstall`／`installDeps`、`timeout`)原樣送出:`[LB02d]`(spy 不轉呼叫 w-playwright);非布林之 `autoInstall`／`installDeps` 用預設 `true`:`[LB08]`.
- 旗標組之內容(六旗標原序＋`--lang=zh-TW`)以測試內之獨立契約值比對(`[LB00]`),不以受測陣列自比.
- `opt.args` 含無效元素時整個 `args`(含旗標組之 `--lang=zh-TW`)被捨棄,w-playwright 改補主機語系:`[LB03]`(模擬主機語系 de-DE).

### R-LB-5 測試之啟動紀律
- 本套件之測試只啟動 headless shell(無頭、未給通道);不得啟動真 Chrome、Edge、完整 Chromium.每個 e2e 檔以 `before` 起一個瀏覽器、`after` 關,案例各開 context/page.
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

## 2. 改動範圍 → 測試檔

| 改動範圍 | 受影響之測試檔 |
|---|---|
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
