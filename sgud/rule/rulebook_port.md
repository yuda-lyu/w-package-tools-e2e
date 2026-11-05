# 規則帳本: 埠之監聽者查詢與處置(`listenerPids`、`killPortListeners`)

本檔為 `sgud/rule/rulebook.md` 之分檔(類型: port 政策原語).編列依據: 主控 opensrcOper 2026-10-30 派工 e2e01(系統回報 TCP 連線狀態值錯誤, netstat 不可信; wsemi 1.9.32 新增 `execProcessPortPids(Sync)`; 見 `sgud/exp/experience.md`「Windows 11 26300 之 netstat 不可信」).

## 1. 規則

| 編號 | 規則 | 實作 | 測試 |
|---|---|---|---|
| P-01 | `listenerPids` 委由 wsemi `execProcessPortPidsSync` 查詢, 本套件不自行解析 netstat／lsof 文字; 判定不依狀態欄 | `src/listenerPids.mjs` | `[LP01]`～`[LP05]` |
| P-02 | 回傳契約: PID **字串**陣列(去重、由小到大); `[]` 只代表已確認無人; 查詢失敗(含 port 不合法)回 `null`, 絕不以 `[]` 表失敗 | 同上 | `[LP07]`、`[LP08]`、`[LP14]`、`[LP15]` |
| P-03 | Windows: netstat 漏列時由 `Get-NetTCPConnection -LocalPort` 確認; netstat 失敗亦轉查 | wsemi | `[LP06]`、`[LP09]`(夾具) + `[RP01]`(本機真實) |
| P-04 | 對外連線之狀態被錯置為 LISTENING 不得判為監聽; 監聽列之狀態被錯置(FIN_WAIT_1)仍判為監聽 | wsemi | `[LP04]`、`[LP05]`、`[KP05]` |
| P-05 | `useBoth`／`timeout`／`onTrace`／`exec`／`platform` 逐項透傳至 wsemi; 未傳 `useBoth` 時 netstat 有列即不再查 PowerShell | `src/listenerPids.mjs` | `[LP10]`～`[LP13]`(M03～M07 變異) |
| P-06 | `killPortListeners` 查詢固定傳 `useBoth: true`(殺行程要完整集合), 不可由呼叫端關閉 | `src/killPortListeners.mjs` | `[KP01]`、`[KP02]`(M08、M09 變異) |
| P-07 | 查詢失敗(`pids === null`)一律不下殺, 回 `{ pids: null, killed: [] }`; 無人不下殺; `exclude`(預設本行程)內之 PID 不殺 | 同上 | `[KP03]`、`[KP04]`、`[KP06]` |
| P-08 | 下殺成功之判準: 執行函數回傳物件、無 `error`、`status === 0`; 其餘(含拋錯、非物件、`status≠0`)不列 `killed` 且不拋錯, 是否釋放由呼叫端回驗 | 同上 | `[KP08]`(M11、M17、M18 變異) |
| P-09 | `opt.exec` 為 spawnSync 形 `(prog, args, { src, timeout, maxBuffer }) => { status, stdout, error }`, `killPortListeners` 之 `exec` 查詢與下殺共用; 預設執行函數不經 shell、隱藏視窗、stdin 不開、帶逾時 | 同上 | `[KP07]`、`[KP08]`、`[RP04]`(攔截 `spawnSync` 驗選項; M19～M21 變異) |
| P-10 | `timeout`: 非正數／非數字為 10000, 小數進位(spawnSync 之 `timeout` 須為整數), 同時用於查詢與下殺 | 同上 | `[KP09]`(M22、M23 變異) |
| P-11 | 本套件不匯出 netstat／lsof 文字解析器(`parseListenerPids` 已於 2026-10-30 移除), 下游不得再自行解析 | — | `unit-WPackageToolsE2e`(入口目錄列舉守門) |

## 2. 輸入空間表(Windows 路徑)

軸: netstat 結果 × PowerShell 結果 × `useBoth`; 每格之預期與測試.

| netstat | PowerShell | useBoth | 預期 | 測試 |
|---|---|---|---|---|
| 有列 | (不查) | false | 回 netstat 之 PID | `[LP01]`、`[LP03]`、`[LP04]`、`[LP10]` |
| 有列 | 有列(他 PID) | true | 聯集 | `[LP10]`、`[KP02]` |
| 有列 | 查無 | true | 保留 netstat 之列 | wsemi D20(本套件未重複) |
| 有列 | 失敗 | true | `null` | `[LP11]`、`[KP06]` |
| 查無／整列缺漏／對外連線錯置 | 有列 | 任 | 回 PowerShell 之 PID | `[LP06]`、`[RP01]` |
| 查無／整列缺漏／對外連線錯置 | 查無 | 任 | `[]` | `[LP05]`、`[LP07]`、`[KP04]`、`[KP05]` |
| 查無／整列缺漏 | 失敗(ENOENT／逾時／離開碼非 0／無標記／拋錯／非物件) | 任 | `null` | `[LP08]` |
| 失敗(ENOENT／逾時／拋錯) | 有列 | 任 | 回 PowerShell 之 PID | `[LP09]` |
| 失敗 | 失敗 | 任 | `null` | `[LP08]`、`[KP06]` |
| 空輸出 | 查無 | 任 | `[]`(空輸出視為無法解析而轉查, 由 PowerShell 確認) | `[LP07]` |

非 Windows: lsof 有輸出／離開碼 1／離開碼其他／ENOENT／拋錯 → `[LP15]`、`[KP07]`.

## 3. 已知限制

- Linux／macOS 之 lsof 非 root 時看不到他人帳號之程序, 此時 `[]` 不代表他人帳號無人監聽(wsemi Q1, 待主控裁示); 本機為 Windows, lsof 路徑只以注入夾具驗證, 真機未跑.
- 本機真實案(`[RP01]`～`[RP04]`)只在 Windows 保證必過; 非 Windows 且 lsof 不可用時 `this.skip()`.
- PowerShell 固定輸出之格式屬 wsemi 內部(`test/tools/portPidsFake.mjs`), wsemi 改版時須同步.
- `killOwnTree` 之 `opt.exec` 仍為 execSync 形, 與 `killPortListeners` 不一致(本輪未改, 可另案統一).
- 變異 M24(下殺不用注入之 `exec`)刻意不做, 見 `sgud/exp/experience.md`.

## 4. 下游(依 wsemi 報告 `run01-修正報告.md` §6)

| 站點 | 須做 |
|---|---|
| w-web-task `test/tools/harnessProc.mjs`(經 `e2eLib.mjs` 轉出本套件) | 升版後生效; `spawnOwn` 之 `isOwnedBy(listenerPids(port), child.pid)` 宜改傳 `{ useBoth: true }` |
| w-web-task `test/unit-harnessProc.test.mjs` | 刪除 `parseListenerPids` 之案; `listenerPids`／`killPortListeners` 之替身改 spawnSync 形 |
| w-web-api、w-web-perm、w-web-sso `test/tools/e2eLib.mjs` | 若轉出 `parseListenerPids` 須移除該行 |

## 5. 變更紀錄

- 2026-10-30(e2e01): 初編; 對應 README §5 Breaking changes.
- 2026-11-05(pe309): 新增 §6 自動換埠(`reserveE2ePorts`); 對應 README §2.12、§5.
- 2026-11-05(pe312): §6 新增 R-15～R-24(就緒核對、`restart` 查不到不續行、`reselect` 用盡之訊息、查埠逾時、行程表改 OS API、查無監聽者之訊息); 對應 README §2.4、§2.12、§5.
- 2026-11-05(pe316): §6 新增 R-26(試綁定第 5 種, `ipv6Only` 之 `::`)、R-27(殺殘留後等待釋放時偵測失敗不當成可用)及其兩張輸入空間表; 移除「`ipv6Only` 之 `::` 偵測不到」之限制; 新增首次偵測失敗仍 fail-open 之限制; 對應 README §2.12、§5.

## 6. 自動換埠(`reserveE2ePorts`; 2026-11-05 pe309)

編列依據: 跨套件規格 `C:\opensrcOper\dspec\e2e埠與多套件同跑.md`(E1～E8)、主控 pe309 派工. 測試: `test/unit-reserveE2ePorts.test.mjs`(注入; `[PR*]`)、`test/api-reserveE2ePorts.test.mjs`(真實監聽行程; `[RA*]`)、`test/e2e-portInImage.test.mjs`(真 Chromium; `[PI*]`)、`test/api-shardE2e.test.mjs`(與多開; `[S-A*]`).

### 6.1 模組與單一擁有者

| 事項 | 唯一擁有者 |
|---|---|
| 埠解析(基準埠＋位移) | `resolveE2ePort`(不重造); 自動換埠只寫 `E2E_PORT_OFFSET`、`E2E_PORT_HOLD` |
| 預約與實際綁定驗證(單開、多開共用) | `createE2ePortClaimer`(`src/reserveE2ePorts.mjs`) |
| 選定位移、重選、baseOnly 等待 | `reserveE2ePorts` |
| 實際綁定檢查(4 個位址) | `checkPortFree`(`src/checkPortFree.mjs`; 同步呼叫走子行程 `tools/portProbe.mjs`) |
| 下殺判定 | `reapShardProcesses`(`src/reapShardProcesses.mjs`; 只 `identity`、`chain`) |

### 6.2 規則與測試對照

| 編號 | 規則(規格句) | 實作 | 測試 |
|---|---|---|---|
| R-01 | E1: 沒有占用時為基準埠, `E2E_PORT_OFFSET` 維持未設, 只偵測一次 | `reserveE2ePorts` | `[PR01]`、`[PR01b]`、`[RA3]` |
| R-02 | E2、E3: 任一埠被占用即整組移位, 對應關係不變, 寫入位移供 `resolveE2ePort`、子行程取得 | 同上 | `[PR02]`、`[PR03]`、`[RA1]` ×3 位址 |
| R-03 | E4: 占用者一律不殺; 例外只有同一專案之殘留預約所記、身分完全相符者 | `tryOffset`、`reapShardProcesses` | `[PR06]`、`[PR14]`、`[PR15]`、`[PR15c]`、`[RA1]`、`[RA4]`、`[RA4b]`、`[RA6]` |
| R-04 | E5: 重選上限內失敗即停, 訊息寫明誰占用(PID 與映像名, 不取命令列); 不留預約、不改環境變數 | `select` | `[PR04]`、`[PR04b]`、`[RA6]` |
| R-05 | E5: 保留後被未導入者占走: 管理器拋錯, 不沿用、不下殺; 行程內自行監聽者以 `reselect` 重選 | `createServiceManager.ensure`、`reselect` | `[PR80]`、`[PR81]`、`[PR40]`、`[PR41]`、`[RA8]` |
| R-06 | E6: 實際埠印入輸出(`[e2e-port]`), 略過之埠列出占用者 | `printOutcome` | `[PR01]`、`[PR02]`、`[RA1]` |
| R-07 | E7: `baseOnly` 只用基準埠, 被占用時等待不換埠; 逾時拋 `E2E_PORT_BASE_BUSY`; `assertE2eBasePort` 擋位移實例; 比對端覆蓋有實測 | `reserveE2ePorts`、`assertE2eBasePort` | `[PR50]`～`[PR54]`、`[RA7]`、`[RA7b]`、`[PI1]`～`[PI4]` |
| R-08 | 競爭: 每埠一檔, 排他建立, 由小到大取; 被預約之埠不做實際綁定; 取不齊全部撤回 | `claimPort`、`tryOffset` | `[PR10]`～`[PR13]`、`[RA2]`、`[RA2b]`、evidence `stress-*.json` |
| R-09 | 預約殘留: PID 不存在、或 PID 存在而起始時間差逾 60 秒(PID 回收)為已死, 回收在守衛內; 行程表取不到視為仍在; 不可讀 60 秒內視為仍在 | `holderAlive`、`judgeHolder`、`reclaim` | `[PR14]`、`[PR14b]`、`[PR16]`、`[PR17]`、`[RA4]`、`[S-A7]` |
| R-10 | 與多開: 已設 `E2E_PORT_OFFSET` 不換埠(`pinned`); `E2E_PORT_HOLD` 沿用(`inherited`); 多開配發走同一預約, 互相避開 | `reserveE2ePorts`、`runShardedE2e` | `[PR30]`～`[PR33]`、`[RA9]`、`[S-A4]`、`[S-A5]`、`[S-A6]` |
| R-11 | 誤用即拋錯: 保留前已呼叫 `resolveE2ePort`／`createServiceManager`(否則換埠時常數過期); 不合法之基準埠或位移 | `reserveE2ePorts` | `[RA5]`、`[PR32]`、`[PR60]` |
| R-12 | 已導入時管理器: restart 只殺身分已確認之監聽者, 其餘拋錯; 服務就緒前結束立即拋錯; 就緒後記入預約. 未導入者完全不變 | `createServiceManager` | `[PR82]`～`[PR84]`、`unit-serviceManager`(不動) |
| R-13 | `noteOwn` 背景取樣不阻塞測試、不重疊, 只記存活者與其子孫之真實起始時間; `killOwnListeners` 只殺該埠之監聽者 | `makeHandle` | `[PR70]`～`[PR74]`、`[PR73b]` |
| R-14 | 選項非預期值用預設(K3); 登錄目錄不可建立時警告並只靠實際綁定; 偵測子行程失敗時警告並照預約繼續 | `reserveE2ePorts`、`createE2ePortClaimer` | `[PR62]`、`[PR19]`、`[PR20]` |
| R-15 | 就緒核對: 自建之服務(`ensure` 之 spawn 與 `restart`)於就緒探測通過後, 該埠之**每個**監聽者須為 spawn 回傳之行程或其存活子孫才放行, 之後才 `noteOwn`; 不分是否導入 `reserveE2ePorts` | `verifyDef`、`verifyReady`(`src/createServiceManager.mjs`)、`judgePortOwner`(`src/reapShardProcesses.mjs`) | `[SU01]`～`[SU13]`、`[SU20]`、`[SU29]`、`[SA4]`～`[SA7]` |
| R-16 | 核對不符(他人、查無監聽者): 重試共 3 次仍不符即拋 `E2E_PORT_NOT_OWN`, 寫明埠與占用者, 只收自建, **不下殺占用者**; 涵蓋「偵測與綁定之間被搶走」與靜默改埠 | 同上 | `[SU21]`、`[SU22]`、`[SU22b]`、`[SU25]`～`[SU27]`、`[SU30]`、`[SU31]`、`[SA1]` ×4 位址、`[SA2]`、`[SA10]`; 真實 vue-cli 見 pe312 報告 |
| R-17 | 核對查詢失敗(`null`): 重試共 3 次仍查不到拋 `E2E_PORT_OWNER_UNKNOWN`, 不當成無人或自己人, 只收自建 | 同上 | `[SU10]`、`[SU11]`、`[SU23]`、`[SU24]`、`[SU24b]`、`[SA11]`、`[SA12]` |
| R-18 | 沿用既有服務(未 spawn)不核對: `pinned`、`inherited`、未導入者之語意照舊 | `ensure` | `[SU28]`、`[SA9]` |
| R-19 | `restart` 查不到監聽者(`pids:null`、`tableOk:false`)時重試共 3 次, 仍查不到即拋錯不續行, 不 spawn; 查得到且為他人則立即拋錯不重試; `tableOk:false` 不得說成他人占用 | `killForeign`(`src/createServiceManager.mjs`)、`killOwnListeners`(`src/reserveE2ePorts.mjs`) | `[SU40]`～`[SU45]`、`[SU54]`、`[SA20]`、`[SA21]` ×4 位址 |
| R-20 | `reselect` 用盡: 訊息與 `err.trigger` 含觸發本次重選之埠(組內全部)與占用者、原因; 重選成功不多查一次 | `s.reselect` | `[SU50]`～`[SU53]`、`[SA30]` ×4 位址 |
| R-21 | 查埠逾時: 查埠一律用 `PORT_QUERY_TIMEOUT_MS`(`src/listenerPids.mjs`), 不寫死字面值 | `describePortOwners`、`judgePortOwner`、`killOwnListeners`、`runShardedE2e` | `[SU12]`、`[SU14]`、`[SU15]`、`[SU54]` |
| R-22 | 就緒逾時: 已導入者之訊息寫明該埠占用者(非 HTTP 占用者使探測一直不通時查得到是誰) | `waitReady` | `[SU33]`、`[SA3]` |
| R-23 | 行程表: Windows 優先 `NtQuerySystemInformation`(Reflection.Emit, 不編譯 C#), 不可用或自我核對(本行程之映像名與起始時間)不符退回 `Get-CimInstance`; 輸出欄位與語意不變; PID、父 PID、起始時間(毫秒)、映像名與舊法逐筆相同; 下殺判準不變 | `PS_TABLE`(`src/reapShardProcesses.mjs`) | `[PT1]`～`[PT8]`(真實行程表, 含真實下殺; 退回路徑有受限語言模式與配置錯誤) |
| R-24 | 「查無監聽者」之訊息寫實際成因(僅綁定未監聽之 socket、保留埠), 不寫 TIME_WAIT 為成因; 判定不放寬 | `MSG_NO_LISTENER` | `[SU09]`、`[SA31]` |
| R-25 | 新選項依 K3: `verifyOwner`、`exec` 非函數、`ownerRetryMs` 非有效非負數視為未給; 重試迴圈提供 `onTrace`(`owner-check`、`restart-query`; 同步、凍結、拋錯忽略; 規格〈計時器相關函數之觀察回調與測試〉) | `createServiceManager` | `[SU37]`、`[SU38]`、`[SU41b]` |
| R-26 | 試綁定五種, 依序 `127.0.0.1`、`0.0.0.0`、`::`(雙棧)、`::1`、`{ host:'::', ipv6Only:true }`: 每種占用形式只和同形式之試綁定衝突(雙棧 `::` 與 `ipv6Only` 之 `::` 互不衝突, pe316 實測), 少一種就有占用者偵測不到; 前四種不帶 `ipv6Only` 選項(與舊版同形); 失敗時 `host` 為 `'::(ipv6Only)'`; 本機無 IPv6(`EAFNOSUPPORT`、`EADDRNOTAVAIL`)之含 `:` 位址(含第 5 種)不算占用; 被占用即換埠、不動占用者 | `BIND_TRIES`、`checkPortFree`(`src/checkPortFree.mjs`) | `[CU1]`～`[CU7]`、`[CF1]`～`[CF5]`(×5 種占用形式; 占用者 PID 不變且仍回應) |
| R-27 | 殺殘留後等待釋放時偵測失敗(`probe` 回 `null`)不是「全部可用」: 視為仍忙, 保留最後一次成功偵測之結果, 等滿 25 次仍失敗即不可用並換下一個位移, `blocked` 之 `code` 為 `PROBE_FAILED`、`owners` 寫明偵測子行程失敗與最後一次成功偵測之結果; 等待中途失敗後恢復則繼續等到偵測回報可用。**每個位移之第一次偵測失敗**(殺殘留前, 或沒有殘留可殺; 如偵測工具壞掉)不在此列: 警告後照預約結果繼續(`[PR20]` 既定, 見 §6.4) | `tryOffset`(`src/reserveE2ePorts.mjs`) | `[PR15d]`、`[PR15e]`、`[PR15f]`、`[PR15g]`、`[PR20]` |

### 6.3 輸入空間表

軸: 基準埠狀態 × 環境變數 × 模式; 每格之應然與測試(「—」為該組合不可達).

| 基準埠狀態 | 未設位移 | 已設位移(手動/多開外) | 上層保留(HOLD) | baseOnly |
|---|---|---|---|---|
| 空閒 | 基準埠 `[PR01]` | 依指定 `[PR30]` | 沿用 `[PR31]` | 基準埠 `[PR50]` |
| 部分或全部被占用 | 整組移位 `[PR02]`、`[RA1]` | 不換埠, 告警 `[PR30]`、`[PR30b]` | 沿用, 不偵測 `[PR31]` | 等待 `[PR51]`、`[RA7]` |
| 全部位移皆被占用 | 拋 EXHAUSTED `[PR04]`、`[RA6]` | 同上 | 同上 | 逾時拋 BASE_BUSY `[PR52]`、`[RA7b]` |
| 被他人預約(存活) | 換埠 `[PR10]`、`[RA2]` | 告警 `[PR30]` | 沿用 | 等待(同上) |
| 他人預約已死、本專案、有 known | 依身分殺, 回基準埠 `[PR15]`、`[RA4]` | 同左(`tryOffset` 共用) | 不處理 | 同左 |
| 他人預約已死、他專案 | 只回收預約; 占用者在即換埠 `[PR14]`、`[RA4b]` | 同左 | 不處理 | 等待 |
| 保留後才被占走 | 管理器拋錯 `[PR80]`、`[RA8]`; 自行監聽者 `reselect` `[PR40]` | 沿用政策(不變) | 沿用政策(不變) | 同未設 |

試綁定(R-26)之輸入空間表: 軸為占用形式(5) × 試綁定(5) = 25 格; 對角線 5 格為 `EADDRINUSE`(偵測到), 其餘 20 格為可綁(互不衝突; 實測 `bind-matrix-five.log`); 另「無占用」1 列。每格之應然: 對角線被偵測並回該形式之 `host`、其餘不誤報; 無占用全可綁.

| 占用形式 \ 試綁定 | `127.0.0.1` | `0.0.0.0` | `::`(雙棧) | `::1` | `::`(ipv6Only) |
|---|---|---|---|---|---|
| `127.0.0.1` | 衝突 `[CF1]` | 可綁 | 可綁 | 可綁 | 可綁 |
| `0.0.0.0` | 可綁 | 衝突 `[CF1]` | 可綁 | 可綁 | 可綁 |
| `::`(雙棧) | 可綁 | 可綁 | 衝突 `[CF1]` | 可綁 | 可綁 |
| `::1` | 可綁 | 可綁 | 可綁 | 衝突 `[CF1]` | 可綁 |
| `::`(ipv6Only) | 可綁 | 可綁 | 可綁 | 可綁 | 衝突 `[CF1]`(pe316 新增) |
| 無占用 | 可綁 `[CF3]` | 可綁 | 可綁 | 可綁 | 可綁 |

「可綁」之 20 格由實測矩陣(`bind-matrix-five.log`)證明, 測試以「只有同形式衝突、host 為自身形式」間接涵蓋(`[CF1]` 五種各回自己之 `host`, 不得回其他形式; `[CF5]` 兩種同時存在回第一個). 注入層: `[CU1]`～`[CU7]`.

殺殘留後等待釋放(R-27)之輸入空間表: 軸為偵測結果序列(殺前一次, 殺後至多 25 次); 每格之應然與測試.

| 殺前偵測 | 殺後偵測序列 | 應然 | 測試 |
|---|---|---|---|
| 占用 | 立即可用 | 取得基準埠, 只偵測 1 次(殺殘留後之偵測即為第 1 次, 不進等待) | `[PR15f]`、`[PR15]` |
| 占用 | 占用, 占用, 可用 | 取得基準埠(等待釋放) | `[PR15b]` |
| 占用 | `null`, `null`, 占用, 可用 | 取得基準埠; `null` 不提早放行, 繼續等 | `[PR15e]` |
| 占用 | 一直 `null` | 換下一個位移; `code` 為 `PROBE_FAILED`; 訊息寫明偵測失敗與最後一次成功偵測之結果; 撤回預約 | `[PR15d]` |
| 占用 | `null`, 其後一直占用 | 換下一個位移; 以最後一次成功偵測為準: `code` 為偵測所回(非 `PROBE_FAILED`), 訊息不寫偵測失敗 | `[PR15g]` |
| 占用 | 一直占用 | 換下一個位移(原行為, `code` 為偵測所回) | `[PR15c]`(無 known)、`[PR02]` |
| 占用(無殘留可殺) | — | 不等待, 直接換埠 | `[PR15f]` |
| `null`(首次) | — | 警告後照預約結果繼續(既定) | `[PR20]` |

就緒核對(R-15～R-18)之輸入空間表: 軸為監聽者查詢 × 行程表查詢 × 自建行程狀態 × 占用者位址; 每格之應然與測試(占用者位址 `127.0.0.1`、`0.0.0.0`、`::`、`::1` 皆跑 `[SA1]`、`[SA20]`、`[SA21]`、`[SA30]`; `ipv6Only` 之 `::` 於 pe316 起由試綁定偵測而換埠, 不再走到核對).

| 監聽者查詢 | 行程表 | 自建行程 | 應然 | 測試 |
|---|---|---|---|---|
| 全屬本服務(本身、子孫) | 正常 | 存活 | 放行 | `[SU01]`、`[SU02]`、`[SA4]`～`[SA7]` |
| 有他人(單獨或並存) | 正常 | 存活 | 重試後拋 `E2E_PORT_NOT_OWN`, 只列他人 | `[SU03]`、`[SU04]`、`[SU21]`、`[SA1]`(`0.0.0.0`、`::`、`::1`) |
| 有他人 | 正常 | 已結束(`EADDRINUSE`) | 同上, 訊息含離開碼 | `[SU26]`、`[SA1]`(`127.0.0.1`) |
| 他人片刻即離開 | 正常 | 存活 | 重試後放行 | `[SU22]`、`[SU22b]`、`[SA10]` |
| 監聽者為已斷鏈之孫行程 | 正常 | 已結束或中間行程已結束 | `E2E_PORT_NOT_OWN`(已知限制) | `[SU06]`、`[SA8]` |
| 監聽者不在行程表 | 正常 | 存活 | `E2E_PORT_NOT_OWN`, 訊息寫明 | `[SU13]` |
| `[]` | — | 存活 | 重試後 `E2E_PORT_NOT_OWN`(查無監聽者) | `[SU09]`、`[SU25]` |
| `null`(一直) | — | 存活 | `E2E_PORT_OWNER_UNKNOWN` | `[SU10]`、`[SU24]`、`[SA11]` |
| 有 | `null`(一直) | 存活 | `E2E_PORT_OWNER_UNKNOWN` | `[SU11]`、`[SU24b]` |
| `null` 後恢復 | 正常 | 存活 | 重試後放行 | `[SU23]`、`[SA12]` |
| 不查(未 spawn, 沿用) | — | — | 不核對 | `[SU28]`、`[SA9]` |
| 不查(`opt.verifyOwner`) | — | — | 由呼叫端確認; 拋錯走同一收尾 | `[SU32]` |

### 6.4 已知限制

- 只防已導入者互撞與偵測當下之占用者; 未導入者於保留後才綁定, 由管理器大聲報錯, 不自動處理; 非 e2e 測試之撞埠(E8)另案.
- 就緒核對: launcher 先結束、服務由孫行程接手者無法判定(`E2E_PORT_NOT_OWN`; 使用端現無此寫法, 2026-11-05 盤點 4 套件); 容器等無法以行程鏈判定者用 `opt.verifyOwner`.
- 就緒核對於探測通過後做一次: 放行之後才被占走者不再偵測(服務已綁定者, 他人只能並存於別的位址).
- 偵測子行程於選埠時失敗(回 `null`; 指每個位移之第一次偵測, 即殺殘留前或沒有殘留可殺時)警告後照預約結果繼續(`[PR20]` 既定: 不因偵測工具壞掉而換埠或中止): 該埠是否被占用未經確認. pe316 實跑曾走到此分支一次(位移 100 之偵測失敗, 證據 `demo-v6only-first-run-slow.log`; 成因未查明, 同腳本重跑 1 秒內正常), 與 R-27 同族但取捨不同(fail-open 以免偵測工具壞掉時所有 e2e 無法開跑), 未改, 列需裁示.
- 試綁定只涵蓋上列五種形式(實測矩陣為此五種占用形式 × 五種試綁定); 綁定在其他位址(如本機網卡位址)之占用者未實測, 不保證偵測到.
- 占用者綁 `::1`、vue-cli `--host 127.0.0.1` 時 portfinder 改埠, 而 `127.0.0.1` 之探測一直不通: 由就緒逾時擋下(等滿 `readyTimeoutMs`), 訊息寫明占用者; 不提早判定(占用者與服務本可並存, 無法分辨服務是尚未就緒或已改埠).
- `reselect` 用盡後預約已釋放而 `h.ports`、`h.offset` 仍為舊值(既有語意: 不留預約、不改環境變數); 呼叫端應中止, 不再使用該 handle.
- `killOwnListeners` 之 `skipped` 含下殺未成者(`gone`、`pending`、`exec-failed`; 既有), 此時 `restart` 之訊息仍說「非本實例」: 失敗方向安全(拋錯不續行), 訊息偶爾不準.
- 登錄目錄在使用者家目錄(刻意不用 `os.tmpdir()`: `TEMP` 可能依工作階段不同, 看不到彼此之預約就失去互斥); 跨使用者帳號不互斥(各帳號仍受實際綁定檢查).
- 預約之持有者判定用近似起始時間(容差 60 秒), 只用於回收預約; 下殺一律依行程表之真實起始時間(容差 0).
- `applyEnv:true` 之位移被常數取用後不可重選(常數已過期), 管理器因此只報錯、不重選.
- 一個實例一個管理器: 同一行程內第二個管理器會把第一個啟動之服務當成他人.
- POSIX 只有注入測試.

### 6.5 改動範圍 → e2e 檔

改 `reserveE2ePorts`、`checkPortFree`、`resolveE2ePort`: 跑 `unit-reserveE2ePorts`、`api-reserveE2ePorts`、`unit-portOffset`、`api-shardE2e`(`[S-A*]`);改 `checkPortFree`(試綁定)另跑 `unit-checkPortFree`、`api-checkPortFree`; 改 `createServiceManager`、`judgePortOwner`: 另跑 `unit-serviceOwner`、`api-serviceOwner`、`unit-serviceManager`; 改 `PS_TABLE`、`listProcessTable`: 另跑 `api-procTable`、`unit-shardProcIdentity`、`api-shardKillIdentity`、`api-shardE2e`; 改畫面含埠之指引: `e2e-portInImage`. 固定埠: 19620、19630(`api-reserveE2ePorts`, 位移 100 起)、19640(`e2e-portInImage`, 不監聽)、19650 起(`api-serviceOwner`, 每案遞增)、19800、19801(`unit-serviceOwner`, 注入, 不監聽)、19960 起(`api-checkPortFree`, 每案遞增, 位移 100 後為 20060 起)、19961～19967(`unit-checkPortFree`, 替身, 不監聽). 測試一律以 `E2E_PORT_REG_DIR` 或 `regDir` 另指登錄目錄.
