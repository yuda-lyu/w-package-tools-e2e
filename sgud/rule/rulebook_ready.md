# 規則帳本: 截圖就緒條件(樣式表、捲動)、`pollUntil` 每次判斷之期限、child_process 隱藏視窗、`dist/` 工具

2026-11-24 twe1(主控排程第 529、504、604 項①～④;需求出處為使用端回報).API 細節見 `README.md` §1.1、§1.3、§2.3、§5 之 2026-11-24 條與各模組 JSDoc.

## 1. 規則與測試對照

| 規則 | 內容 | 擁有者 | 測試 |
|---|---|---|---|
| R-RD-1 截圖前等樣式表 | `captureStable` 於凍結 SMIL 之後、`fonts.ready` 之前呼叫 `waitStyleSheets`(預設開,`waitStyles:false` 關);逾時仍載入中或 http(s) 同源載入失敗:strict 拋錯(訊息含 href 與「regen 拒絕寫入樣式表未載入之畫面」),否則 `console.warn('[style-not-ready] …')` 續行 | `src/captureStable.mjs` | `e2e-readyWaits` `[RS-01]`(不經替身)、`[RS-03]`(事件同步:進入等待後才放行)、`[RS-04]`、`[RS-05]`、`[RS-07]`(關閉即改版前) |
| R-RD-2 量框前等樣式表 | `captureStableWithBox` 於量框之前等樣式表(讀 `opt.waitStyles`／`styleTimeoutMs`／`waitStylesFn` 而不移除,照常透傳給 `capture`;本處不拋錯) | `src/captureStableWithBox.mjs` | `[RS-02]`(紅框涵蓋套用 CSS 後之按鈕) |
| R-RD-3 載入中／失敗之判定 | `sheet` 為 null 即載入中(Chromium 159 實測:404、連線重設者 `sheet` 非 null 且已觸發 error,`[RS-05]` 兩者皆驗);`sheet` 留為 null 之失敗(SRI 不符等):等待中收到 error,或 Resource Timing 已有紀錄而 1 秒寬限後仍 null,判失敗(不論來源)、不等逾時;`sheet` 非 null 者之失敗只判 http(s) 同源之 `responseStatus` 為 0 或 ≥ 400;不納入 disabled、rel 含 `alternate`、無 href;每 200ms 重查以涵蓋等待中新插入者 | `src/waitStyleSheets.mjs` | `[RS-05]`(404 不等逾時)、`[RS-06]`(已載入、無樣式表、跨來源 404;開關截圖逐位元相同)、`[RS-08]`、`[RS-09]`(跨來源成功而 status 0)、`[RS-10]`(`file:`)、`[RS-11]`(SRI 不符:等待前、等待中兩種) |
| R-RD-2b 量框前未就緒告警 | `captureStableWithBox` 量框前之等待仍有載入中或失敗者即印 `[style-not-ready] captureStableWithBox 量框前…`(框可能依素頁版面) | `src/captureStableWithBox.mjs` | `[RS-04]` |
| R-RD-4 捲入前等捲動結束 | `captureStableWithBox` 有捲入對象(第一個目標非矩形且有 `scroll`)時,於 tall 判定與 `scrollIntoViewIfNeeded` 之前呼叫 `waitScrollIdle`(預設開,`waitScrollIdle:false` 關);逾時(`scrollIdleTimeoutMs`,3000)印 `[box-scroll-busy]` 續行 | `src/captureStableWithBox.mjs` | `[SI-01]`(平滑捲動跑完至 600)、`[SI-02]`(關閉即被截斷)、`[SI-03]`(無捲動時開關之量框相同)、`[SI-04]`、`[SI-05]`(矩形目標不呼叫) |
| R-RD-5 捲動靜止之判定 | document 之 capture 階段監聽 scroll;連續 `quietFrames`(3)個影格無 scroll 即靜止;硬逾時回 `idle:false`;頁面隱藏(rAF 停擺)而 250ms 內無影格即判靜止,可見而影格晚到者照常等(硬逾時兜底)——不懸置 | `src/waitScrollIdle.mjs` | `[SI-03]`(開關截圖逐位元相同)、`[SI-04]` |
| R-PU-1 每次判斷之期限 | 每次判斷與 `min(attemptTimeout, 距整體逾時之剩餘, 2^31-1)`(未給 `attemptTimeout` 時為剩餘)競賽;整體逾時一到即拋錯,訊息註明「最後一次判斷未於期限內完成」;單次期限先到則續輪詢;`timeout` 為 Infinity 或極大者照常輪詢 | `src/pollUntil.mjs` | `unit-harnessHelpers` `[PU-A1]`、`[PU-A2]`、`[PU-A3]`、`[PU-A5]`、`[PU-A8]` |
| R-PU-2 被放棄之判斷 | 被放棄者 `ctx.signal` abort;其後完成之值忽略、其後之 reject 已攔下(不成為 unhandledRejection);期限內完成者 signal 不 abort;被放棄不清除此前之錯誤(逾時訊息兩者並列) | 同上 | `[PU-A1]`、`[PU-A3]`、`[PU-A4]`、`[PU-A9]` |
| R-PU-3 期限內完成者行為不變 | 回傳值、錯誤訊息格式、`lastErr` 之覆寫規則(拋錯〔含 reject(undefined)〕覆寫、falsy 不清除)與改版前相同;`fn` 同步呼叫(時點同改版前);`attemptTimeout` 非正數拋錯,null／undefined 視為未給 | 同上 | 既有 `pollUntil` 6 案、`[PU-A6]`、`[PU-A7]` |
| R-CP-1 child_process 隱藏視窗 | 本庫 `src/`、`tools/`、`toolg/`、`test/*.test.mjs`、`test/tools/*.mjs` 之每一處起子行程之呼叫(child_process 全家,含別名 `spawnSyncFn = spawnSync`、`exec = execSync` 與命名空間 `cp.spawn`)皆帶 `windowsHide: true`;JSDoc 範例同 | 各檔 | `unit-childProcHide` `[CP-S1]`(盤點器之鑑別力)、`[CP-S2]`(全庫,防空集合:檔數 ≥ 50、呼叫數 ≥ 40、`runIsolatedE2e` 恰 2 處);`unit-harnessHelpers` `[RI-W1]`(注入,兩條路徑兩平台) |
| R-DS-1 dist 過期告警 | `warnDistStale` 依最新修改時間判斷,印 `[dist-stale]`、不擋不拋;`no-dist` 亦告警;`no-src` 不告警;讀取失敗回 `reason:'error'` 並告警;不跟進目錄連結;`ignore` 之 RegExp 每次歸零 `lastIndex` | `src/warnDistStale.mjs` | `unit-distTools` `[DS-01]`～`[DS-07]` |
| R-DG-1 原位元組還原 | `restore` 清空 `dist/` 後寫回、還原修改時間,回驗檔案清單、目錄清單、逐檔 sha256 與修改時間,通過才刪備份;不符即拋錯並保留備份 | `src/createDistGuard.mjs` | `[DG-01]`、`[DG-06]`、`[DG-08]` |
| R-DG-2 崩潰自癒 | manifest 最後寫(暫存名改名);備份途中結束則下次丟棄重做;備份完成後任一時點結束則下次 `start` 先還原再重備份(含備份時 dist 不存在者) | 同上 | `[DG-02]`(建置後)、`[DG-03]`(備份途中)、`[DG-04]`(還原途中)、`[DG-13]`(原無 dist) |
| R-DG-3 連結與路徑守門 | `dist/`、`buildDir` 內有目錄連結即拋錯不處理(還原前亦檢查);`distDir`、`snapDir` 皆須在 `projRoot` 之內且不得為 `projRoot`(`distDir` 亦不得為磁碟根或 `projRoot` 之祖先);`snapDir`／`distDir`／`buildDir` 不得相同或互為祖孫;刪 `snapDir` 前確認其內只有 `files`、`manifest.json(.tmp)` | 同上 | `[DG-07]`、`[DG-09]`、`[DG-10]` |
| R-DG-4 暫時覆蓋 | `useBuild` 須先 `start`;`replace` 使 `dist/` 與建置完全相同,`overlay` 只覆蓋同名檔 | 同上 | `[DG-05]` |
| R-DG-5 持有者 | manifest 記錄持有者 PID;他行程之 `start` 見持有者存活即拋錯(不自癒、不動 dist);PID 重用之誤判只會使其拒絕 | 同上 | `[DG-11]` |
| R-K3 新 opt 之非預期輸入 | 依 `dspec/輸入參數之檢測機制.md` K3 視為未給、改用預設不拋錯:`pollUntil` 之 `attemptTimeout`、`captureStable` 之 `waitStylesFn`／`styleTimeoutMs`、`captureStableWithBox` 之 `waitScrollIdleFn`／`scrollIdleTimeoutMs`、`waitStyleSheets`／`waitScrollIdle` 之 opt、`warnDistStale` 之全部 opt;**例外**:`createDistGuard` 之路徑類 opt 與 `useBuild` 之 `buildDir`／`mode` 給了而無效即拋錯(遞迴刪除之對象,比照 K3 之安全例外) | 各檔 | `[PU-A6]`、`[RS-12]`、`[SI-05]`、`[DS-06]`、`[DG-09]` |
| R-D3 訊息遮罩 | `captureStable` 之 `[style-not-ready]` 告警與拋錯訊息含頁面之網址(外來值),經 wsemi `maskDiagText`(只遮憑證與查詢秘密值,一般網址不變;`dspec/診斷輸出與遮罩.md` D3) | `src/captureStable.mjs` | `[RS-12]` |
| R-DG-6 manifest 損毀 | 無法解析即拋帶路徑之錯誤,`start`／`restore`／`status` 皆然,不當成無備份、不動 dist 與備份 | 同上 | `[DG-12]` |

## 2. 輸入空間表

### 2.1 樣式表(`waitStyleSheets` × `captureStable` 之 strict)

| `<link>` 狀態 | 非 strict | strict | 測試 |
|---|---|---|---|
| 已載入(同源、跨來源) | 不等、不告警 | 同左 | `[RS-06]`、`[RS-09]` |
| 載入中,逾時內完成 | 等至載入後截 | 同左 | `[RS-01]`、`[RS-03]` |
| 載入中,逾時仍未完成 | 告警後截(素頁) | 拋錯 | `[RS-04]` |
| 同源載入失敗(404、連線重設) | 告警後截 | 拋錯 | `[RS-05]` |
| 失敗而 `sheet` 留 null(SRI 不符;等待前或等待中) | 告警後截(不等逾時) | 拋錯 | `[RS-11]` |
| 跨來源載入失敗 | 不判失敗、不告警(無從判定) | 同左 | `[RS-06]` |
| `file:` 頁之樣式表 | 不判失敗 | 同左 | `[RS-10]` |
| disabled／alternate／無 href | 不納入 | 同左 | `[RS-08]` |
| 無 `<link>` | 不等 | 同左 | `[RS-06]` |
| `waitStyles:false` | 改版前(不等) | 同左 | `[RS-07]` |

### 2.2 捲動(`captureStableWithBox` 之捲入前)

| 頁面捲動狀態 | 第一個目標 | 行為 | 測試 |
|---|---|---|---|
| 平滑捲動進行中(`--enable-smooth-scrolling`) | 選擇器(完整可見之捲動容器) | 等動畫結束後捲入,終點不被截斷 | `[SI-01]`;關閉之對照 `[SI-02]` |
| 無捲動(預設啟動,Chromium 159 之 programmatic smooth 即時完成) | 選擇器 | 約 3 影格即續行,量框與關閉時相同 | `[SI-03]` |
| 持續捲動(跑馬燈) | 選擇器 | 逾時告警 `[box-scroll-busy]` 後照常 | `[SI-04]` |
| 任意 | 矩形 | 不等(不捲入) | `[SI-05]` |

### 2.3 `pollUntil` 之判斷(× 是否給 `attemptTimeout`)

| 判斷之行為 | 結果 | 測試 |
|---|---|---|
| 期限內成立／falsy／拋錯 | 同改版前 | 既有 6 案、`[PU-A7]` |
| 卡住(永不完成) | 整體逾時拋錯、signal abort(兩種 `attemptTimeout`) | `[PU-A1]` |
| 整體逾時後才完成 | 先拋錯,遲到之值不回傳 | `[PU-A2]` |
| 單次卡住、下次成立 | 回傳下次之值;被放棄者 abort、成立者不 abort | `[PU-A3]` |
| 被放棄後才 reject | 無 unhandledRejection | `[PU-A4]` |
| 每次皆卡 | 多次判斷後整體逾時拋錯 | `[PU-A5]` |

### 2.4 `createDistGuard` 之中止點(標記與鎖之推演,全域技能 role-coder-for-validate Step 6)

| 中止點 | 下次 `start` | 測試 |
|---|---|---|
| 備份途中(manifest 未寫) | 丟棄不完整備份重做;`dist/` 未被動 | `[DG-03]` |
| 備份後、建置中或建置後 | 先自備份還原再重備份 | `[DG-02]` |
| `useBuild` 途中 | 同上(manifest 已在) | 推論同 `[DG-02]`(未另設案) |
| `restore` 途中(已清空、只寫回部分) | 先自備份還原(manifest 保留) | `[DG-04]` |
| `start` 之自癒途中 | 同 `restore` 途中(manifest 保留至回驗通過) | 推論同 `[DG-04]`(未另設案) |
| manifest 存在而無法解析 | 拋帶路徑之錯誤,不當成無備份(不覆寫、不動 dist) | `[DG-12]` |
| 他行程持有(並行) | 持有者存活即拋錯 | `[DG-11]` |

## 3. 改動範圍 → 測試檔

| 改動範圍 | 受影響之測試檔 |
|---|---|
| `src/captureStable.mjs`、`src/captureStableWithBox.mjs`、`src/waitStyleSheets.mjs`、`src/waitScrollIdle.mjs` | `e2e-readyWaits`、`e2e-captureEquivalence`(凍結複本對照,須全綠)、`e2e-browserPrimitives`、`e2e-portInImage`、`e2e-itemsUnionBoxGraphics`;實質為全部 e2e 檔 |
| `src/pollUntil.mjs` | `unit-harnessHelpers` |
| `src/runIsolatedE2e.mjs` 與任何 child_process 呼叫 | `unit-harnessHelpers`、`unit-childProcHide` |
| `src/warnDistStale.mjs`、`src/createDistGuard.mjs` | `unit-distTools` |
| 入口 `src/WPackageToolsE2e.mjs` | `unit-WPackageToolsE2e` |

## 4. 已知限制

- 樣式表:只認 `<link rel=stylesheet>`;`<style>` 內之 `@import`、JS 動態寫入之 CSSOM、`adoptedStyleSheets` 不在判定內;`sheet` 非 null 者之跨來源與 `file:` 載入失敗無從判定(Chromium 159:跨來源未帶 Timing-Allow-Origin 時 `responseStatus` 恆為 0;`file:` 資源無 Resource Timing 紀錄);Resource Timing 緩衝已滿而查無紀錄者不判為失敗;`sheet` 留為 null 而於等待開始前即失敗且無 Resource Timing 紀錄者等到逾時;同一 href 先前已載入過、新 `<link>` 自快取載入而 1 秒內未完成者會被判為失敗(寬限之代價,未實測到).
- 樣式表真卡住時,`captureStableWithBox` 量框前與 `captureStable` 各等一次(最長約 2 倍 `styleTimeoutMs`),前者只告警、後者依 strict 拋錯或告警.
- 捲動:只偵測已開始之捲動;`waitScrollIdle` 返回之後才開始之捲動(例:應用程式延遲數百 ms 才觸發)不在範圍;頁面隱藏(背景分頁)時 250ms 內判靜止.
- `waitStyleSheets`／`waitScrollIdle` 之 `page.evaluate` 不攔錯:導覽中、頁面已關閉時拋 Playwright 之原生錯誤(與既有之量框 `page.evaluate` 同).
- 本套件只驗 headless shell(Chromium 159);504 之原始現象(Chromium 156 之平滑捲動動畫)以 `--enable-smooth-scrolling` 重現,未以 156 實跑.
- `pollUntil`:被放棄之判斷若不理會 `signal`,其工作(例:`fetch`)在背景續跑至自行結束;`fn` 多收一參數,把「會用第一參數之既有函數」直接傳入者須包一層.
- `warnDistStale`:只依修改時間,git checkout／pull 同時改到 `src/` 與 `dist/` 時可能誤報或漏報(故只告警不擋).
- `createDistGuard`:同一 `snapDir` 同時只能一個行程使用(以持有者 PID 存活與否判定,非互斥鎖:兩行程於同一瞬間各自 `start` 而皆無 manifest 時不互斥);目錄之修改時間不還原;崩潰後若刻意改過 `dist/`,下次 `start` 仍會還原(印 `[dist-guard]`);未 fsync,斷電之可靠性未保證.
- `[CP-S2]` 之盤點以去註解後之正則與括號配對判讀,字串內含不成對括號或規則運算式內含 `//` 者可能誤讀;以檔數、呼叫數與 `runIsolatedE2e` 恰 2 處防範圍壞掉.

## 5. 變更紀錄

- 2026-11-24 twe1:建立本檔(R-RD-1～5、R-PU-1～3、R-CP-1、R-DS-1、R-DG-1～4).修前(HEAD 之 `src/`、`test/` 加本輪新測試)17 failing、`unit-distTools` 模組不存在;修後 `npm test` 883 passing.同輪依獨立複審(sonnet)補:R-PU-1 計時器上限、R-PU-2 不清除此前錯誤、R-RD-3 `sheet` 留 null 之失敗、R-RD-2b、R-RD-5 只於隱藏頁判無影格為靜止、R-DS-1 `lastIndex`、R-DG-3 projRoot 之內與 snapDir 內容核對、R-DG-5、R-DG-6、修改時間回驗;主責自查補 R-K3、R-D3.
- 變異(2026-11-24,`./tmp` 鏡像根逐項植入、以鏡像根為工作目錄跑對應檔):64 項,擊殺 57、存活 7——等價 3(`file:` 無 Resource Timing 紀錄而 http(s) 限定無從觸發;Dirent 之連結既非目錄亦非檔而「略過連結」拿掉仍不跟進;Windows 之 `copyFileSync` 保留修改時間而 `utimes` 拿掉仍相同〔非 Windows 未驗〕)、缺口 4(等待中之 error 記錄〔Resource Timing 寬限兜底,只縮短等待〕、寬限值〔剖析中之大樣式表〕、可見頁面無影格〔高負載〕、修改時間之回驗〔`utimes` 失敗才觸發〕;皆無可確定重現之案,記為已知).
