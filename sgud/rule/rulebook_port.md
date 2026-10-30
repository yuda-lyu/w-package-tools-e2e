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
