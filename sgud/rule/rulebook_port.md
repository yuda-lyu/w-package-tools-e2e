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

### 6.4 已知限制

- 只防已導入者互撞與偵測當下之占用者; 未導入者於保留後才綁定, 由管理器大聲報錯, 不自動處理; 非 e2e 測試之撞埠(E8)另案.
- 登錄目錄在使用者家目錄(刻意不用 `os.tmpdir()`: `TEMP` 可能依工作階段不同, 看不到彼此之預約就失去互斥); 跨使用者帳號不互斥(各帳號仍受實際綁定檢查).
- 預約之持有者判定用近似起始時間(容差 60 秒), 只用於回收預約; 下殺一律依行程表之真實起始時間(容差 0).
- `applyEnv:true` 之位移被常數取用後不可重選(常數已過期), 管理器因此只報錯、不重選.
- 一個實例一個管理器: 同一行程內第二個管理器會把第一個啟動之服務當成他人.
- POSIX 只有注入測試.

### 6.5 改動範圍 → e2e 檔

改 `reserveE2ePorts`、`checkPortFree`、`resolveE2ePort`: 跑 `unit-reserveE2ePorts`、`api-reserveE2ePorts`、`unit-portOffset`、`api-shardE2e`(`[S-A*]`); 改畫面含埠之指引: `e2e-portInImage`. 固定埠: 19620、19630(`api-reserveE2ePorts`, 位移 100 起)、19640(`e2e-portInImage`, 不監聽). 測試一律以 `E2E_PORT_REG_DIR` 或 `regDir` 另指登錄目錄.
