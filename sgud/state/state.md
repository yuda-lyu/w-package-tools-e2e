# 狀態

本檔只記現況(各功能做到哪裡、對應帳本與測試、已知缺口與待辦、最近一次驗證);過程寫入 `sgud/exp/experience.md`.

## 版本與最近驗證

- `package.json` version:1.0.13(pte35 未改;下表標「未發布」者是否已含於 1.0.12／1.0.13 未逐項核對;發布由使用者／主控之自動化流程處理).
- 最近一次全套驗證:2026-11-01 pte35b(Gitea #35 續,`opt` 依 K3 改用預設),`npm test` 505 passing、0 failing(485 → 505,`e2e-waitDrawerReady` 58 → 78 條;4m,`--lock`)、lint 0 error、變異 33 個全數擊殺(M33 僅因訊息內含預設選擇器字樣而被擊殺,行為等價);修前版本(pte35 完成時)跑新測試 58 passing／20 failing;未派外審.報告 `C:\opensrcOper\dnow\20261031234910\agent-out\pte35b-修正報告.md`.
- 前一輪全套驗證:2026-11-01 pte35,`npm test` 485 passing、0 failing(427 → 485)、變異 14/15 擊殺(存活 1 為預期等價體);報告 `pte35-修正報告.md`.
- 前一輪全套驗證:2026-10-30 e2e01,`npm test` 427 passing、0 failing(412 → 427, 本輪 `unit-procPrimitives` 淨增 15 條; 3m07s, `--lock`)、lint 0 error、變異 24/24 擊殺(`unit-procPrimitives` 之 `listenerPids`／`killPortListeners`);未派外審.報告 `C:\opensrcOper\dnow\20261030064553\agent-out\e2e01-修正報告.md`.
- 更早一輪全套驗證:2026-10-28 pte2e-run01,`npm test` 412 passing(其中 issue #19 新增 69 條)、lint 0 error、變異 70/70、新舊差分 34 組全同;外審 terra 兩輪(22＋14 條)已處置.報告 `C:\opensrcOper\dnow\20261028061508\agent-out\pte2e-run01-修正報告.md`.

## 功能現況

| 功能 | 狀態 | 帳本 | 測試 | 已知缺口／待辦 |
|---|---|---|---|---|
| 截圖與影像(captureStable、captureStableWithBox、composeBox、遮罩與覆蓋、輸入與等待) | 完成(四專案實跑) | README §1.1、§2.3 | `e2e-browserPrimitives`、`e2e-captureEquivalence`、`unit-imageOps`、`unit-adapters` | — |
| itemsUnionBox 圖形內容(issue #6) | 完成 | `rulebook.md` §7 | `e2e-itemsUnionBoxGraphics` | 限制 L1～L12(README §2.7) |
| 產製與比對管線(runBaselineCase、createBaselineGate、孤兒檢查) | 完成 | `rulebook.md` §1～§6 | `unit-runBaselineCase`、`unit-baselineGate` | — |
| 已知缺陷分流(整案／部分;issue #4、#5) | 完成 | `rulebook.md` 表 A、表 B | 同上 `[A..]`／`[B..]` | 限制 B15、B21、B22 |
| 收集模式(issue #19-1;`E2E_COLLECT`、createBaselineCollector) | 完成,未發布 | `rulebook_baselineRun.md` §8 | `unit-baselineCollect` `[C..]` | 使用端(rddmanager)之報告判讀程式須依新格式調整(提出方自理) |
| 審查與採用(issue #19-1-3;reviewPendingShots、acceptPendingShots、`tools/reviewPending.mjs`) | 完成,未發布 | 同上 | `unit-reviewPending` `[R..]` | 限制見 §8.6(since 同毫秒、孤立 diff 改寫、legacy 須明示) |
| 有變更才改寫(issue #19-2;`E2E_BASELINE_KEEP_SAME`／`KEEP_MAXDIFF`、writeBaselineIfChanged、compareBuf、transient) | 完成,未發布 | 同上 | `unit-keepSame` `[K..]` | 使用端須把自訂 `match` 內之覆蓋移到 `compareBuf` 才能「同一覆蓋」 |
| 埠位移(issue #19-3;`E2E_PORT_OFFSET`、resolveE2ePort、createServiceManager) | 完成,未發布 | 同上 | `unit-portOffset` `[P..]` | 使用端 setup 須改由 spawn 收到之 `port` 啟動服務、baseUrl 經 `resolveE2ePort` |
| 生命週期與行程(createServiceManager、registerCleanupHooks、所有權與 port 原語、runIsolatedE2e) | 完成(own 政策未提供) | README §2.4 | `unit-serviceManager`、`unit-procPrimitives`、`unit-harnessHelpers` | own 政策(README §7) |
| 埠之監聽者查詢與處置(`listenerPids`、`killPortListeners`;e2e01,2026-10-30) | 完成,未發布(破壞性: `opt.exec` 改 spawnSync 形、移除 `parseListenerPids`、新增依賴 `wsemi`) | `rulebook_port.md`、README §5 Breaking changes | `unit-procPrimitives` `[LP*]`／`[KP*]`／`[RP*]`(含本機真實監聽與真實子程序) | 下游(w-web-task 等)須改替身形狀並刪 `parseListenerPids` 案、身分確認傳 `useBoth:true`(`rulebook_port.md` §4);lsof 路徑真機未跑;`killOwnTree` 之 `opt.exec` 仍 execSync 形 |
| settle 掛鉤之元件辨識(`waitDrawerReady` 只認 WDrawer 根節點,預設選擇器 `[state][changedrawerwidth]`、新增 `opt.selector`／`opt.debug`／`opt.funLog`,`opt` 非預期輸入依 K3 改用預設不拋錯;Gitea #35,2026-11-01) | 完成,未發布(行為變更: 自家以裸 `state` 表示過場之元件須傳 `selector`;`timeout` 數字字串／0／負數、`opt=null` 之行為改變;README §5) | `rulebook_settle.md` | `e2e-waitDrawerReady`(78 條)、`e2e-browserPrimitives`、`e2e-captureEquivalence` | 預設選擇器依元件內部屬性 `changedrawerwidth`,元件改版須以 `node test/tools/probeWDrawerDom.mjs <w-component-vue 根目錄>` 複驗;不再順帶等 WDialog／浮層過場(2.5.35 前本就未等) |
| 盤點 CLI(auditBoxes、auditWaits) | 完成 | `sgud/proc/process.md` | `unit-auditWaits`(auditBoxes 無單元測試) | — |
| 驗證工具(snapshotBaselines、diffBaselineSnapshots、compareImageDirs) | 完成 | README §4 | `unit-baselineTools` | — |

## 文件整理待辦

- `sgud/rule/rulebook.md`(約 39KB)與 `sgud/exp/experience.md`(約 38KB)已逾 30KB:帳本新章節已改依類型分檔(§8 → `rulebook_baselineRun.md`),§1～§7 之分檔與經驗檔之抽出尚未做.
