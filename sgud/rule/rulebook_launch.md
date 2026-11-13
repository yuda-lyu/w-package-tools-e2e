# 規則帳本:瀏覽器之啟動(經 w-playwright)

編列依據:排程第 442 項之遷移輪(2026-11-13,pm-pte);w-playwright 之設計報告 §5.1 本套件之列、§5.2;w-playwright 帳本 R-PW-ONLY、R-PW-WIRING.API 與行為變更見 `README.md`〈Installation〉之〈瀏覽器之取得與啟動〉、§1.1 `launchBrowser`、§5 之 2026-11-13 條.

## 1. 規則

### R-LB-1 唯一啟動出口
- `src/launchBrowser.mjs` 為本套件唯一之瀏覽器啟動處:`wpw.launchChromium({ headless: true, autoInstall: true, installDeps: true, ...opt, args: [...chromiumLaunchArgs, ...opt.args] })`(`wpw` 為 `import wpw from 'w-playwright'` 之預設匯出;`opt.args` 非陣列時忽略;`opt.autoInstall`、`opt.installDeps` 非布林值〔含 `undefined`、`null`〕時改用預設 `true`——dspec〈輸入參數之檢測機制〉K3,否則 `...opt` 之 `undefined` 會使 w-playwright 改用其預設 `false`;外審 terra F1).
- 不提供 `launchChromium`、`launchChromiumCore`(2026-11-13 移除,不保留相容層;w-playwright 設計之約束 3、原則 14).使用端需不帶六旗標之啟動者直接用 `wpw.launchChromium`.
- 六旗標(`src/chromiumLaunchArgs.mjs`)不移入 w-playwright(截圖確定性屬本套件);改動即全量重產(不變).

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
- 六旗標之內容以測試內之獨立契約值比對(`[LB00]`),不以受測陣列自比.

### R-LB-5 測試之啟動紀律
- 本套件之測試只啟動 headless shell(無頭、未給通道);不得啟動真 Chrome、Edge、完整 Chromium.每個 e2e 檔以 `before` 起一個瀏覽器、`after` 關,案例各開 context/page.
- 本套件無「以真啟動探測可用性」或「改寫 `chromium.launch`」之測試(2026-11-13 盤點:`rg -n "channel|headless:\s*false|chromium\." test` 無啟動用之命中);新增時依 w-playwright 設計 §5.2 改用 `findSystemChrome`／`setBrowserTypeForTest`.

## 2. 改動範圍 → 測試檔

| 改動範圍 | 受影響之測試檔 |
|---|---|
| `src/launchBrowser.mjs`、`src/chromiumLaunchArgs.mjs`、`package.json` 之 w-playwright 版本 | `api-launchBrowserWiring`、全部 e2e 檔(`e2e-browserPrimitives`、`e2e-captureEquivalence`、`e2e-itemsUnionBoxGraphics`、`e2e-portInImage`、`e2e-probeStuckTooltip`、`e2e-waitDrawerReady`;皆經 `launchBrowser`)、`unit-WPackageToolsE2e` |
| `src/WPackageToolsE2e.mjs`(入口之鍵) | `unit-WPackageToolsE2e` |
| 截圖、量框、等待類原語 | 對應之 e2e 檔(見 `README.md` §6) |
| 埠、行程、分組多開 | `unit-*`、`api-*` 之對應檔(`rulebook_port.md`、`rulebook_shard.md`) |

## 3. 已知限制

- 依賴樹有兩份 w-playwright 時 `setBrowserTypeForTest` 只作用於測試所引用之一份;`[LB01]` 斷言替身被呼叫以防空過.
- `[LB01]`～`[LB03]` 之 spy 依 `launchBrowser` 於呼叫時以 `wpw.launchChromium` 取函數(屬性查找);改為解構匯入時 spy 失效而轉紅,屬預期之守門.
- 本套件無標準圖;「標準圖不變」對下游為推測(限預設呼叫、未自給功能開關與 `ignoreDefaultArgs`),由全庫連動之比對確認;新舊路徑未做同頁截圖之直接比對(舊路徑屬未經 w-playwright 之啟動).
- 替身與 spy 以 `afterEach` 兜底還原(mocha 逾時不取消進行中之 Promise);`[LB07]` 之子行程逾時以 `taskkill /T` 樹狀結束(非 Windows 只結束子 node 行程).
- `launchBrowser(null)` 於讀 `opt.args` 時拋原生 `TypeError`(與改版前相同,未改;外審 terra F3).
