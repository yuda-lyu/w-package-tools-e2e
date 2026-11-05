# 狀態

本檔只記現況(各功能做到哪裡、對應帳本與測試、已知缺口與待辦、最近一次驗證);過程寫入 `sgud/exp/experience.md`.

## 版本與最近驗證

- `package.json` version:1.0.22(pe309 之自動換埠已發布於此版;pe312 未改版本;依賴 wsemi ^1.9.50;下表標「未發布」者是否已含於已發布版本未逐項核對;發布由使用者／主控之自動化流程處理).
- 最近一次全套驗證:2026-11-05 pe312(就緒核對、`restart` 查不到不續行、行程表改 OS API),`npm test` 794 passing、0 failing(約 11 分,`--lock`)、lint 0 error、變異 55 個全數擊殺、修前副本(HEAD 之 src)20 failing／9 passing;使用端實跑 w-flow-vue 363 passed(基準埠 3 輪、占用基準埠 1 輪)、w-web-perm 多開全套 5414 passing、`kills` 0 筆;未派第三方外審(sonnet 唯讀審查 1 次).報告 `C:\opensrcOper\dnow\20261105072000\agent-out\pe312-修正報告.md`.
- 前一輪全套驗證:2026-11-05 pe309(自動換埠;拿掉環境區塊與工作目錄證據),`npm test` 704 passing、0 failing(約 9 分,`--lock`)、lint 0 error、變異 58 個擊殺 57(存活 M06 為等價)、修前副本(HEAD＋舊行為接縫)70 failing／7 passing、競爭實測 30 輪 110 行程 0 重複(修前 8 輪全撞);未派外審.報告 `C:\opensrcOper\dnow\20261105000800\agent-out\pe309-修正報告.md`.
- 前一輪全套驗證:2026-11-04 pe307(分組多開之下殺須正面確認身分),`npm test` 624 passing、0 failing(約 9 分,`--lock`)、lint 0 error、變異 42 個全數擊殺、修前副本(舊判定＋注入接縫)43 failing／3 passing;未派外審.報告 `C:\opensrcOper\dnow\20261104223900\agent-out\pe307-修正報告.md`.
- 前一輪全套驗證:2026-11-04 se302(e2e 分組多開),`npm test` 577 passing、0 failing(505 → 577;約 5 分,`--lock`)、lint 0 error、變異 62 個全數擊殺、3 組無變異基準全綠;另以 w-web-api 副本實跑真瀏覽器 51 passing;未派外審.報告 `C:\opensrcOper\dnow\20261104071854\agent-out\se302-修正報告.md`.
- 前一輪全套驗證:2026-11-01 pte35b(Gitea #35 續,`opt` 依 K3 改用預設),`npm test` 505 passing、0 failing(485 → 505,`e2e-waitDrawerReady` 58 → 78 條;4m,`--lock`)、lint 0 error、變異 33 個全數擊殺(M33 僅因訊息內含預設選擇器字樣而被擊殺,行為等價);修前版本(pte35 完成時)跑新測試 58 passing／20 failing;未派外審.報告 `C:\opensrcOper\dnow\20261031234910\agent-out\pte35b-修正報告.md`.
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
| e2e 分組多開(`runShardedE2e`、`planE2eShards`、`listDirLinks`、`removeE2eInstance`、`tools/shardE2e.mjs`、`tools/shardE2eReporter.cjs`;se302,2026-11-04) | 完成,未發布;共用工具已就緒,`w-web-perm`、`w-web-sso`、`w-web-api` 之導入由主控另派(清單見 `C:\opensrcOper\dnow\20261104071854\agent-out\se302-修正報告.md`) | `rulebook_shard.md` | `unit-planE2eShards`、`unit-removeE2eInstance`、`api-shardE2e` | POSIX 路徑未實測;Windows 之 TerminateProcess 由下次開跑清除 |
| 分組多開之下殺判定(未經正面確認身分之行程一律不殺;每次下殺留紀錄;鎖檔 `known`／`procCreateMs`;pe307,2026-11-04;pe309 拿掉環境區塊與工作目錄證據) | pe307 已發布於 1.0.21;pe309 之改動未發布;修前已知之「多開收尾疑似誤殺他套件派工」未能事後證明 | `rulebook_shard.md` S-V*、S-K1、S-S1、S-X3、S-F2;README §2.11〈行程身分〉、§5 | `unit-shardProcIdentity`、`api-shardKillIdentity`(注入,變異只跑此二檔)、`api-shardE2e`(真實自建行程) | 未曾被取樣之孤兒殺不到(占埠者大聲報錯、實例保留,其餘只入 `killSkipped`;取樣間隔 10 秒);POSIX 只有注入測試 |
| 自動換埠(`reserveE2ePorts`、`assertE2eBasePort`、`createE2ePortClaimer`、`checkPortFree`、`tools/portProbe.mjs`;多開配發埠走同一預約;pe309,2026-11-05) | 完成,1.0.22 已發布;已導入 9 個使用端,其餘導入由主控另派(清單與優先序見 `C:\opensrcOper\dnow\20261105000800\agent-out\pe309-修正報告.md`) | `rulebook_port.md` §6、`rulebook_shard.md` S-P1～S-P4;README §2.12、§5;跨套件規格 `C:\opensrcOper\dspec\e2e埠與多套件同跑.md` | `unit-reserveE2ePorts`(注入)、`api-reserveE2ePorts`(真實監聽行程)、`e2e-portInImage`(真 Chromium)、`api-shardE2e` `[S-A*]` | 未導入者於保留後才綁定者只報錯不重選;`applyEnv:true` 之位移被常數取用後不可重選;一個實例一個管理器;POSIX 只有注入測試;規格 E8(非 e2e 撞埠)另案 |
| 盤點 CLI(auditBoxes、auditWaits) | 完成 | `sgud/proc/process.md` | `unit-auditWaits`(auditBoxes 無單元測試) | — |
| 驗證工具(snapshotBaselines、diffBaselineSnapshots、compareImageDirs) | 完成 | README §4 | `unit-baselineTools` | — |

| 就緒核對與查詢失敗之處置(`createServiceManager` 之 `verifyDef`、`judgePortOwner`; `restart` 查不到不續行; `reselect` 用盡之訊息; `PORT_QUERY_TIMEOUT_MS`; `listProcessTable` 改 OS API; pe312,2026-11-05) | 完成,未發布(行為收嚴,使用端之正常服務不必改,README §5) | `rulebook_port.md` R-15～R-24 | `unit-serviceOwner`(注入)、`api-serviceOwner`(真實監聽與真實占用者,四種位址)、`api-procTable`(真實行程表) | launcher 先結束者無法判定;真實 vue-cli 只在報告證據跑,不入 `npm test`(本套件無 vue-cli 依賴);使用端可移除自寫之核對(選做) |
| 試綁定增第 5 種(`checkPortFree` 之 `{ host:'::', ipv6Only:true }`,失敗時 `host` 為 `'::(ipv6Only)'`)與殺殘留後偵測失敗不當成可用(`tryOffset` 之等待迴圈;`PROBE_FAILED`);pe316,2026-11-05 | 完成,未發布(沒有占用時埠與行為不變,只在占用與偵測失敗時才走到;README §5) | `rulebook_port.md` R-26、R-27、§6.3 兩張輸入空間表 | `unit-checkPortFree`(替身)、`api-checkPortFree`(真實占用者 × 五種形式)、`unit-reserveE2ePorts` `[PR15d]`～`[PR15f]` | 每個位移第一次偵測失敗(`[PR20]`)仍 fail-open,與 R-27 同族,pe316 報告列需裁示;`src/` 其餘 `\|\| []` 站點已逐處判定(僅 `reserveE2ePorts.mjs:322` 同型) |

## 文件整理待辦

- `sgud/rule/rulebook.md`(約 39KB)與 `sgud/exp/experience.md`(約 38KB)已逾 30KB:帳本新章節已改依類型分檔(§8 → `rulebook_baselineRun.md`),§1～§7 之分檔與經驗檔之抽出尚未做.
