# 規則帳本: e2e 分組多開(`runShardedE2e`、`tools/shardE2e.mjs`)

本檔為 `sgud/rule/rulebook.md` 之分檔(類型: 全量執行之多開工具).編列依據: 主控 opensrcOper 2026-11-04 派工 se302(全套測試中 e2e 佔絕大多數時間; 主控實測埠位移之臨時實例多開全綠,要正式導入;實測腳本 `C:\opensrcOper\dnow\20261104071854\poc\`).規範來源: 全域技能 role-coder-for-test-e2e `references/full-run-and-instances.md` §5.API 細節見 `README.md` §2.11 與各檔 JSDoc;取捨與實測事實見 `sgud/exp/experience.md`「注意事項: 分組多開」.

## 1. 模組與單一擁有者

| 事項 | 唯一擁有者 |
|---|---|
| 分組與記憶體守門(純函數) | `src/planE2eShards.mjs` |
| 不跟進連結之列舉 | `src/listDirLinks.mjs` |
| 實例之移除(§5.5 順序與回驗)、連結目標快照與比對 | `src/removeE2eInstance.mjs`(具名匯出 `snapshotLinkTarget`、`diffLinkTarget`) |
| 流程編排(設定、鎖、預檢、建立實例、執行、收尾、彙整) | `src/runShardedE2e.mjs` |
| 行程身分與下殺(行程表、身分比對、證據、紀錄; 全部下殺路徑之唯一出口) | `src/runShardedE2e.mjs` 之 `reapShardProcesses`(具名匯出, 另有 `listProcessTable`、`findProcessDescendants`、`sampleShardKnown`、`readProcessEvidence`); 根之樹狀終止為 `run.stop` → `killOwnTree` |
| 各組統計(通過、失敗、pending、失敗標題、各檔耗時) | `tools/shardE2eReporter.cjs`(寫 `E2E_SHARD_RESULT`) |
| 命令列 | `tools/shardE2e.mjs` |

## 2. 規則與測試對照

測試檔: `test/unit-planE2eShards.test.mjs`(S-G*、S-M*)、`test/unit-removeE2eInstance.test.mjs`(S-R*、S-L*、S-T*)、`test/api-shardE2e.test.mjs`(S-I*)、`test/unit-shardProcIdentity.test.mjs`(S-P*、S-V*)、`test/api-shardKillIdentity.test.mjs`(S-W*).

| 編號 | 規則 | 實作 | 測試 |
|---|---|---|---|
| S-G1 | 以 `/^e2e-.*\.test\.mjs$/` 列舉 `test/`; 由大到小放入目前最輕之組; 同值依檔名、同輕取編號小者; 結果與輸入順序無關 | `planE2eShards` | `[S-G1]` |
| S-G2 | `officialOnly` 固定第 0 組(位移 0); 含不存在之檔名或型別錯誤即拋錯 | 同上 | `[S-G2]` |
| S-G3 | `together` 不拆開, 有交集者合併(遞移) | 同上 | `[S-G3]` |
| S-G4 | 缺 `durations` 以已知檔之平均值估算; 全無已知值每檔 1 分; 值非正數視同未知; 只用於分組 | 同上 | `[S-G4]` |
| S-G5 | 實例數不超過可分開之單元數(檔案數,扣 `together`、`officialOnly` 合併) | 同上 | `[S-G5]` |
| S-M1 | 依可用記憶體(預設每實例 1.5 GB)調降並印原因; 連 1 個都不夠仍回 1 個並警告 | 同上 | `[S-M1]`、`[S-I4]` |
| S-C1 | 設定讀 `test/tools/e2eShard.json`(可不存在), opt/CLI 覆寫同名欄位; 未知之鍵、壞 JSON 拋錯; `ports` 實跑時必給(無服務者明寫 `[]`) | `runShardedE2e` | `[S-I2]`、`[S-I5]` |
| S-C2 | 跨組撞埠、位移後超過 65535 於動手前拋錯 | `buildPortTable` | `[S-I5]` |
| S-C3 | 只跑比對: `E2E_REGEN=1`、`mochaArgs` 含 `--baseline` 拋錯; 另不得含 `--reporter`、`--parallel` | `runShardedE2e` | `[S-I6]` |
| S-C4 | 多於 1 組且有 `ports` 時, 專案 `test/`、`test/tools/` 之 `.mjs` 須提及 `resolveE2ePort` 或 `E2E_PORT_OFFSET`, 否則拋錯(未接線時各組都用基準埠, 依沿用政策互打而不報錯) | `isPortOffsetAdopted` | `[S-I6]` |
| S-K1 | `workDir` 內之鎖檔以排他建立擋第二個同時執行者; 持有者 PID 已死或起始時間與鎖檔不完全相同(PID 回收)之鎖可接手; 鎖檔無 `procCreateMs`(舊格式、當時取不到行程表)而 PID 存在者視為仍在; 接手在 `.takeover` 守衛內; 內容不可讀者 60 秒內視為仍在 | `acquireLock`、`lockHolderAlive` | `[S-I15]`、`[S-I17]`、`[S-I18]`、`[S-W7]`、`[S-W12]` |
| S-S1 | 開跑前先清殘留: 接手死鎖時先依 S-V1 殺鎖檔之殘留(階段 `stale-lock`; 鎖檔可能已存放數日, 同樣逐筆比對), 舊格式鎖檔不下殺並記警告, 再依 S-R 程序移除 `inst<N>` | `runShardedE2e` | `[S-I15]`、`[S-I16]`、`[S-W5]`、`[S-W6]`、`[S-W7]`、`[S-W9]` |
| S-P1 | 預檢: 每組每埠於 `127.0.0.1`、`0.0.0.0`、`::`、`::1` 試綁定(Windows 下特定位址與萬用位址可並存, 只試一種會漏); 未過即拋錯、列出占用者(PID 與映像名稱, 不取命令列)、不沿用、未建立任何實例 | `checkPortFree`、`describeOwners` | `[S-I19]`、`[S-I24]` |
| S-L1 | 複製前以不跟進連結之方式列出來源樹(不含排除項)之連結, 有即拋錯列出; 建立後回驗實例內之連結恰為 `node_modules`、`test/pics` | `listDirLinks`、`runShardedE2e` | `[S-I20]`、`[S-L*]` |
| S-E1 | 排除 `node_modules .git docs tmp testPending logs sgud test/pics test/_tmp` 與 `exclude`(皆相對專案根, 同名子夾不受影響); `workDir`、`outDir` 在專案樹內時亦不複製; 實例內建空 `logs`; `.env` 等只以 OS 複製, 不讀內容 | `copyTree` | `[S-I22]`、`[S-I1]` |
| S-X1 | 各組以 `E2E_PORT_OFFSET=<組序×portStep>`、cwd 為實例根執行 `node node_modules/mocha/bin/mocha.js --no-parallel <檔> <mochaArgs> --reporter <本套件報告器>`; 隱藏視窗; log 分寫 | `runGroup` | `[S-I1]` |
| S-X2 | 每 `progressMs`(預設 5 分)印一行進度; 每組逾 `groupTimeoutMs`(預設 4 小時)樹狀終止並判未跑完 | 同上 | `[S-I23]`、`[S-I11]` |
| S-X3 | 開跑後立即取樣一次, 之後每 `treeSampleMs`(預設 30 秒)取樣: 根以持有之 `child` 尚未 exit 為證, 取行程表之真實起始時間(不用 `Date.now()`); 其餘只沿存活父子鏈走(S-V2), 已結束者移出 `known`, 誤認不會入 `known` 與鎖檔 | `sampleNow`、`sampleShardKnown` | `[S-I15]`、`[S-V3]`～`[S-V3d]`、`[S-W2]`、`[S-W3]` |
| S-F1 | 收尾於成功、失敗、例外、SIGINT、SIGTERM、SIGBREAK、SIGHUP 皆執行; 重複訊號不中斷收尾 | `runShardedE2e` | `[S-I7]`、`[S-I13]`、`[S-I14]`、`[S-I14b]`、`[S-I25]` |
| S-F2 | 順序: 樹狀終止存活之根(`run.stop`, 行為不變) → 依 S-V1 下殺孤兒(階段 `teardown`) → 回驗本次各埠已釋放; 仍占埠者把監聽者列入 S-V1 之候選再查一次(階段 `teardown-port`, 無證據不殺) → 標準圖未動 → 逐實例搬回 testPending、拆連結、回驗、刪除 | 同上 | `[S-I12]`、`[S-I12b]`、`[S-I13]`、`[S-I26]`、`[S-I27]`、`[S-W1]`、`[S-W11]` |
| S-F3 | 埠未釋放或 `test/pics` 被改動: 大聲報錯、該實例不刪、離開碼非 0; 一個實例失敗不影響其他實例之清除 | 同上 | `[S-I21]` |
| S-R1 | 移除順序不可調: 守門 → 搬回證據 → 列連結(不跟進)→ 取目標基準 → 逐一只拆連結 → 回驗清單為空 → 回驗目標完好 → 遞迴刪除 → 確認不存在 → 再驗目標; 任一步失敗拋錯(`err.step`)且不做後續 | `removeE2eInstance` | `[S-R1]`～`[S-R10]` |
| S-R2 | 遞迴刪除之對象只能是 `workDir` 直屬之 `inst<N>` | 同上 | `[S-R8]` |
| S-R3 | testPending 搬回不覆蓋: 排他複製, 撞名時證據檔之 `-N` 加在時間戳後(同 `assertBaselineMatch`, `reviewPendingShots` 認得), 其餘加在副檔名前; 複製成功才刪來源 | `moveFilesNoOverwrite` | `[S-R3]`、`[S-R3b]`、`[S-R4]`、`[S-I7]` |
| S-O1 | 有失敗、未跑完、某組無統計、空跑、mocha 離開碼與統計不符、收尾失敗 → `exitCode` 非 0; 收到訊號為 128＋訊號值; 開跑前之問題 reject | `runShardedE2e` | `[S-I7]`～`[S-I10]`、`[S-I13]` |
| S-O2 | 印 mocha 同格式之 `N passing`、`M failing`、`P pending`(一律印三行)與失敗標題; 回傳含各組結果與實際耗時 | 同上 | `[S-I1]`、`[S-I7]` |
| S-O3 | 印可貼回之 `durations`(分); `updateDurations` 才寫回, 只改 `durations` 內實測到之鍵 | 同上 | `[S-I1]`、`[S-I2]` |
| S-O4 | 測試層以 root after 呼叫 `process.exit` 時 run end 不發生: 報告器每個事件皆寫檔, 工具以 `total` 判定是否跑完 | `shardE2eReporter`、`runShardedE2e` | `[S-I8]` |
| S-CLI | `--plan` 不取鎖、不建立任何東西; 參數錯誤離開碼 2; 開跑前之問題離開碼 1 | `tools/shardE2e.mjs` | `[S-I3]` |
| S-V1 | **不變式: 未經正面確認身分之行程一律不殺**(取樣、收尾、鎖檔殘留、占埠監聽者皆同). 可下殺: `identity`(PID 與起始時間完全相同, 容差 0)、`chain:<父>`(S-V2)、`env-marker`／`instance-cwd`(S-V3); 根為 `own-child-handle` | `reapShardProcesses` | `[S-V1]`、`[S-V1b]`、`[S-V2]`、`[S-V4]`、`[S-V5]`、`[S-W1]` |
| S-V2 | 只沿存活父子鏈走: 父身分已確認且存活, 子之起始不早於父. 已結束之父不走其下(ParentProcessId 不清除且 PID 會回收); 起始早於存活之父者為假關係 | `walkLiveTree`、`findProcessDescendants` | `[S-P1]`～`[S-P4]`、`[S-V5]` |
| S-V3 | 未曾被取樣之孤兒: 父已結束(父不存在、父起始晚於子; 非 Windows 另含 ppid=1)、起始不早於該次開跑, 且環境變數帶該次之 `E2E_SHARD_RUN=<runId>` 或工作目錄位於 `workDir` 內才下殺, 其存活子孫沿鏈下殺. 只回傳是否相符, 內容不離開讀取程式, 不取命令列. 無證據不殺, 入 `killSkipped` | `readProcessEvidence`、`reapShardProcesses` | `[S-V9]`～`[S-V9c]`、`[S-V10]`、`[S-V10b]`、`[S-V14c]`、`[S-V17]`、`[S-V17b]`、`[S-I12b]`、`[S-I26]`、`[S-I27]`、`[S-I28]` |
| S-V4 | 仍占本次埠之監聽者不因「起始晚於開跑」下殺(可能是他人接手該埠), 須有 S-V3 之證據(不限父已結束); 無證據記警告, 由 S-F3 大聲報錯 | `reapShardProcesses` 之 `extra` | `[S-V10]`、`[S-V10c]`、`[S-W11]`、`[S-I27]` |
| S-V5 | 本行程與祖先鏈(祖先起始不晚於其子, 遇假關係即止; 另含 `process.ppid`)永不下殺, 也不經其往下走; 記 `protected` | `protectedPids` | `[S-V6]`、`[S-V6b]`、`[S-P5]`、`[S-W9]` |
| S-V6 | 取不到行程表、讀不到證據: 不下殺、記警告, 由回驗埠與刪實例把關; 不改用其他方式重殺 | `reapShardProcesses` | `[S-V8]`、`[S-V10b]`、`[S-V13]`、`[S-W8]` |
| S-V7 | 下殺不帶 `/T`(子孫已走訪、逐筆留紀錄); Windows 取 handle 釘住後於同一 handle 比對起始時間才終止, 不符回 `mismatch` | `killIdentified` | `[S-V14]`、`[S-V14b]`、`[S-I29]` |
| S-V8 | 每次下殺留紀錄: PID、映像名、起始時間、判定依據、階段、結果; 寫 `[shard]` 輸出、回傳值、`summary.json`(例外路徑有下殺時亦寫), 並記 `knownCount`. `run.stop` 之樹狀終止以當下行程表逐筆列出 | `mkKillRecord`、`recordStop`、`runShardedE2e` | `[S-V12]`、`[S-W1]`、`[S-W4]`、`[S-W10]`、`[S-I12]`、`[S-I13]`、`[S-I15]` |
| S-V9 | 鎖檔: `procCreateMs` 為行程表之真實起始時間; `runId` 為標記; `known` 只含身分已確認者; 舊格式(`groups`、`procStartMs`)不相容 | `runShardedE2e` | `[S-W3]`、`[S-W7]` |

## 3. 輸入空間表(收尾)

軸: 結束方式 × 實例狀態; 每格之應然皆為「實例移除、目標完好」, 例外者註明.

| 結束方式 | 全部 mocha 正常 | 一組失敗 | 孤兒服務(父子鏈斷) | 測試改動 test/pics |
|---|---|---|---|---|
| 正常跑完 | `[S-I1]` | `[S-I7]` | `[S-I12]`(mocha 硬殺) | `[S-I21]`(大聲報錯、實例保留) |
| 例外(實例已建立) | `[S-I25]` | 不適用(例外發生於開跑前) | 不適用 | 不適用 |
| SIGTERM(處理器; EventEmitter 注入、真子行程) | `[S-I13]` | 同正常收尾路徑 | 同正常收尾路徑 | 同正常收尾路徑 |
| Ctrl-Break 真實主控台事件 | `[S-I14]` | 同上 | 同上 | 同上 |
| Ctrl-C 真實主控台事件 | `[S-I14b]` | 同上 | 同上 | 同上 |
| TerminateProcess(`taskkill /F`、`child.kill`) | 下次開跑清除 `[S-I15]`(含孤兒) | 同左 | 同左 | 下次開跑視為殘留清除(不比對執行前快照) |
| 逾時 | `[S-I11]` | 不適用 | 同正常收尾路徑 | 同正常收尾路徑 |

## 4. 已知限制

- **Windows 之 SIGTERM 無法由外部送達**: `taskkill /F`、`child.kill()`、`process.kill(pid)` 皆為 TerminateProcess, 處理器來不及執行; 此時由下次開跑清除. 真實訊號只有主控台事件(Ctrl-C→SIGINT、Ctrl-Break→SIGBREAK、關主控台→SIGHUP).
- **孤兒之辨識有界(刻意之取捨)**: 未曾被取樣、環境變數被換掉(不繼承 `process.env`)且工作目錄不在 `workDir` 內之孤兒殺不到: 占埠者收尾大聲報錯、實例保留、離開碼非 0, 手動停掉後重跑清除(`[S-I27]`); 不占埠也不鎖實例者留在機器上, 只有 `killSkipped` 有紀錄. 寧可殺不到也不誤殺.
- **`run.stop` 之 `taskkill /T` 未自行走訪**: 實測對「ppid 恰為根而起始早於根」之假子行程不下殺(`experience.md`), 維持原行為; 根已結束時 `run.stop` 不動作.
- **殘留清除不以埠殺行程**: 上一次之埠上之監聽者可能已是他人之服務(第 0 組即正式埠), 故只依 S-V1; 其餘由預檢擋下並列出.
- **證據之讀取依賴未公開之 PEB 配置**(x64 之偏移 0x20、0x38、0x80、0x3F0): Windows 改版使偏移失效時讀不到, 一律視為無證據(不誤殺), 由 `[S-I28]` 抓到.
- **ports 須列全**: 未列入之埠不受預檢; 專案若另開固定埠(如 w-web-api 之 echo 11077), 跨實例自撞, 須以 `officialOnly` 或 `together` 排開.
- **接線檢查是文字掃描**(S-C4): 只證明有提及, 不證明接線正確; 正確性由專案導入時之首次等價驗證負責(全域技能 §5.2 第 7 點).
- POSIX 路徑(`ps`、`/proc`、`kill -9`)只有注入測試, 未實機跑過; 本機為 Windows. 非 Linux 之 POSIX 無證據可用, 未取樣孤兒不下殺.
- `durations` 不含 mocha 載入檔案之時間與 root 層 hook.

## 5. 改動範圍 → e2e 檔

本工具不碰瀏覽器, 無對應之 e2e 檔; 改動後跑 `test/unit-planE2eShards.test.mjs`、`test/unit-removeE2eInstance.test.mjs`、`test/unit-shardProcIdentity.test.mjs`、`test/api-shardKillIdentity.test.mjs`、`test/api-shardE2e.test.mjs`、`test/unit-WPackageToolsE2e.test.mjs`.固定埠: 19200、19210、19300、19310、19400、19500(須空閒).

**變異測試只跑 `unit-shardProcIdentity`、`api-shardKillIdentity`**: 這兩檔之下殺一律走注入、不轉送; `api-shardE2e` 為真實下殺, 判定被變異時可能傷到無關行程, 只有不動判定之變異(如只移除紀錄)才可跑.

## 6. 變更紀錄

- 2026-11-04(se302): 新增 `runShardedE2e`、`planE2eShards`、`listDirLinks`、`removeE2eInstance`、`tools/shardE2e.mjs`、`tools/shardE2eReporter.cjs`.既有 API 之行為與簽章未變; 共用入口多四個鍵.
- 2026-11-04(pe307): 新增 S-V*、S-W*; 改 S-K1、S-S1、S-X3、S-F2; 鎖檔格式改變; `findProcessDescendants` 語意收緊(README §5).
