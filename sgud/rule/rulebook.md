# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

編列依據:Gitea issue #4(runBaselineCase 遇已知缺陷時保留並比對其前各步之截圖)、#5(createBaselineGate.finalize 把已知缺陷案例之未產圖當成 --names 未命中)之審計(`agent-out/run01-審計回應.md`)與修正(2026-10-20);issue #6(itemsUnionBox 不認 svg/canvas 圖形為框外內容)之審計與修正(2026-10-20,見 §7);issue #19(收集模式、有變更才改寫、埠位移;2026-10-28)見分檔 §8.API 細節見 `README.md` §2.1、§2.2 與三檔 JSDoc;取捨緣由見 `sgud/exp/experience.md`「注意事項: 產製與比對」.

**分檔索引**(本檔逾 30KB,新章節起改依類型分檔):§1～§7 在本檔;§8 全量執行之共用層支援(收集模式、有變更才改寫、埠位移、審查與採用)→ `sgud/rule/rulebook_baselineRun.md`;埠之監聽者查詢與處置(`listenerPids`、`killPortListeners`;2026-10-30 e2e01)→ `sgud/rule/rulebook_port.md`.

## 1. 已知缺陷分流(`src/runBaselineCase.mjs`、`src/createKnownDefect.mjs`)

### 1.1 軸

| 軸 | 取值 |
|---|---|
| mode | `regen`(產製端)、`compare`(比對端) |
| run 結局 | 正常完成;拋 knownDefect 無 shots(整案);拋 knownDefect 帶 shots(部分,合法/多/重疊/少/空/形狀);拋一般錯 |
| 組態 | `stages` 未宣告;宣告無 `defectStages`;宣告且有 `defectStages`;`defectStages` 非法 |
| 掛鉤 | `semantic`/`verify` 通過;拋一般錯;拋不帶 shots 之 knownDefect;拋帶 shots 之 knownDefect |
| 前段比對(compare) | 一致;不符;標準圖缺檔;`compareAll` 彙總 |
| gate | 無;`--names` 篩選;`--write-mode`;`E2E_BASELINE_OUT_DIR` |
| 收尾 | `afterCase` 與關瀏覽器(成功/各種失敗路徑皆恰一次,見 A05b) |
| lang(gate 記錄粒度) | 豁免與產出皆以 token 為單位,不區分語系/案例(any-of,見 B21) |

非完整笛卡兒積,依可達性縮減為下表 A01–A22(regen 無「前段比對」軸;非法 `defectStages` 與 mode 無關;`compareOnly` 另列).

### 1.2 缺陷分流表(表 A)

觸發條件:`run` 拋 `err.knownDefect` 且 `err.shots != null` → 部分已知缺陷;`err.shots` 缺省 → 整案(行為同 1.0.8).

| # | mode | 情境 | 規則 | 測試 |
|---|---|---|---|---|
| A01 | regen | 正常完成(K=S) | 全寫;`defectStages` 不放寬正常路徑之 stages 檢查 | `[A01/A02]` |
| A02 | compare | 正常完成 | 全比 | `[A01/A02]` |
| A03 | regen | 整案缺陷(無 shots) | 不寫、`status:'knownDefect'`、`out.shots=[]`;通知 gate(整案) | `[A03/A04]` |
| A04 | compare | 整案缺陷 | 0 張比對,`onKnownDefect` 後 throw | `[A03/A04]` |
| A05 | regen | 部分缺陷,shots 合法(K∪D=S 且 K∩D=∅) | 前段經 `semantic`/`verify` 後走同一寫檔迴圈;印 `[known-defect] … 未產 [D]`;`status:'knownDefect'`;`out.defectStages=D`;通知 gate(keys=D) | `[A05]` |
| A06 | compare | 同 A05,前段全一致 | 逐張比對全過 → `onKnownDefect` → throw | `[A06]` |
| A07 | compare | 前段一張不符 | 拋比對錯誤(`compareAll` 彙總「共 n/m 張」),**不**呼叫 `onKnownDefect` | `[A07/A08]` |
| A08 | compare | 前段標準圖缺檔 | 拋「標準圖不存在」,不呼叫 `onKnownDefect` | `[A07/A08]` |
| A09 | 兩者 | shots 含 stages 外鍵(多) | 拋圖鍵不符,零寫入,仍關瀏覽器 | `[A09-A13]` |
| A10 | 兩者 | shots∩D≠∅(重疊,壞畫面混入) | 拋圖鍵不符(**不**靜默丟棄) | `[A09-A13]` |
| A11 | 兩者 | S−K−D≠∅(少,缺陷早於預期) | 拋圖鍵不符 | `[A09-A13]` |
| A12 | 兩者 | shots 為空且 D=S | 合法,零寫入,`status:'knownDefect'`(compare:0 張比對後交 `onKnownDefect`) | `[A12]` |
| A12b | 兩者 | shots 為空且未宣告 stages | 與正常路徑一致須 `allowEmpty`,否則拋「未產生任何截圖」(防缺陷發生於第一張之前而被歸為 pending 空轉);已宣告 stages 者由三向核對把關(D 須涵蓋全部 stages) | `[A12b]` |
| A13 | 兩者 | shots 為空且 D⊊S | 拋「少」 | `[A09-A13]` |
| A14 | 兩者 | 帶 shots、stages 未宣告 | 不核對,前段照常處理(compare:前段比對後原樣拋出/交 `onKnownDefect`);`out.defectStages=[]`;接 gate 時缺陷步圖鍵無從豁免(見 B22) | `[A14/A15]` |
| A15 | 兩者 | 帶 shots、stages 已宣告無 D | D=∅ 核對:K 須=S(缺陷於全部截圖後才偵測到),否則拋「少」 | `[A14/A15]` |
| A16 | — | `defectStages` 無 stages/含外鍵/非陣列/含空字串 | 開瀏覽器前拋(launch 呼叫數 0) | `[A16]` |
| A16b | — | `defectStages` 為空陣列 | 等同未給(無缺陷步可豁免,不強制併用 stages) | `[A16b]` |
| A17 | 兩者 | 缺陷路徑中 `semantic`/`verify` 拋一般錯 | 原樣拋,regen 零寫入;`ctx.knownDefect`、`ctx.shots`(前段,正規化後陣列)可供掛鉤分流;`ctx.knownDefect.shots` 為使用者原始形狀,掛鉤一律以 `ctx.shots` 為準 | `[A17]` |
| A17b | 兩者 | 掛鉤重新指定 `ctx.shots` | 與正常路徑一致:其後寫出/比對的是替換後之內容 | `[A17b]` |
| A18 | 兩者 | 缺陷路徑中掛鉤拋**不帶** shots 之 knownDefect | 降級整案,與正常路徑之掛鉤拋整案缺陷一致:不寫;`out.shots`/`ctx.shots` 仍為 run 已取得者;移除部分缺陷專屬之 `out.defectStages`、`ctx.knownDefect` | `[A18]` |
| A18b | 兩者 | 掛鉤(缺陷路徑或正常路徑)或 run 之前階段拋**帶** shots 之 knownDefect | 視同一般錯,訊息載明「帶 shots 之已知缺陷僅能由 run 拋出」與拋出位置(不被誤當部分缺陷) | `[A18b]` |
| A19 | regen | `compareOnly`+部分缺陷 | 照跑掛鉤不寫;`skipped`=前段 | `[A19]` |
| A20 | 兩者 | run 拋一般錯 | 原樣拋 | `[A20]` |
| A21 | regen | gate 篩選/`--write-mode` | 與正常路徑共用 `writeShots`:`--names` 只寫命中者;`missing`/`changed` 之 keep/write 同正常 | `[A21]` |
| A22 | 兩者 | shots 形狀 | 同 run 回傳:`{鍵:Buffer}`、`[{name\|key,buf}]`、單一 Buffer(鍵=案例名)、`{shots,page}`(換頁:其後 `semantic`/`verify`/`afterCase` 收到新 page,與正常路徑一致);非 Buffer 由 `normalizeShots` 拋 | `[A22]` |
| A05b | 兩者 | 收尾軸 | `afterCase` 於部分缺陷之成功/掛鉤失敗/前段不符/`onKnownDefect` 拋出/圖鍵不符皆恰執行一次且在關瀏覽器之後 | `[A05b]` |

### 1.3 規則

- 部分缺陷路徑**只**由 `run` 拋出;`run` 之前(prepare/launch/openPage/beforeRun)、`run` 之後(stages 檢查/`semantic`/`verify`)拋帶 shots 之 knownDefect 一律視同一般錯.
- 三向核對(`stages` 已宣告時):多=K−S、重疊=K∩D、少=S−K−D,任一非空即拋;訊息格式 `已知缺陷時產出之圖鍵與宣告不符: 多 […] 與 defectStages 重疊 […] 少 […]`.
- `defectStages` 必與 `stages` 併用(部分缺陷須以完整宣告核對前段),每鍵 ∈ `stages`,於開瀏覽器前檢查.
- 缺陷路徑與正常路徑共用同一個寫檔迴圈(`writeShots`)與比對迴圈(`compareShots`);**兩份碼即為缺陷**.
- `status` 維持 `'knownDefect'`(不新增狀態,以免破壞使用端 `status==='knownDefect'` 判斷);部分缺陷以 `out.defectStages` 區分——該欄**存在(含空陣列)即部分缺陷**,整案無此欄.
- 部分缺陷路徑與正常路徑之 `page`、`ctx.shots` 處理一致(`adoptPage`;掛鉤後以 `ctx.shots` 為準),不另立一套.

## 2. gate 之已知缺陷紀錄與 token 覆蓋(`src/createBaselineGate.mjs`)

### 2.1 token 覆蓋表(表 B)

`finalize()` 之未命中 = `!produced[ti] && !defectCovered[ti]`;`noteKnownDefect(lang, caseName, {keys, message, ref})` 由 `runBaselineCase` 於缺陷分支自動呼叫(`typeof gate.noteKnownDefect === 'function'` 守門;**僅產製端 `mode:'regen'`**,gate 本為產製端用,compare 端不通知).

| # | `--names` 命中 / run 結局 | 規則 | 測試 |
|---|---|---|---|
| B01 | 無 `--names`(全跑) | 只記錄、印摘要,不影響判定 | `[B01]` |
| B02 | 正常案例,正常產出 | 通過(不變) | 既有+`[B13]` |
| B03 | ④(未宣告 stages)案例,圖鍵拼錯 | 仍由 `finalize` 拋,同批有缺陷案例亦然 | `[B03/B04]` |
| B04 | 宣告 stages 案例,圖鍵拼錯 | 構造時拋(不變) | `[B03/B04]` |
| B05 | 整案缺陷案例鍵/邊界前綴 | `keys=null` 覆蓋該案被選中之全部 token → 通過;摘要「整案」 | `[B05/B06]` |
| B06 | 整案缺陷案例之階段圖鍵 | 同上 | `[B05/B06]` |
| B07 | 部分缺陷案例鍵 | 前段已產 → 通過;摘要列缺陷步 | `[B07-B09]` |
| B08 | 部分缺陷案例之前段圖鍵 | 前段已產 → 通過 | `[B07-B09]` |
| B09 | 部分缺陷案例之缺陷步圖鍵 | `keys=D` 以 `matchTokens` 覆蓋命中該鍵之 token → 通過;摘要列該鍵 | `[B07-B09]` |
| B10 | 前段 token 本身未被產出 | 仍列為未命中(缺陷步豁免不及於前段) | `[B10]` |
| B11 | 缺陷已修復,點名缺陷步圖鍵 | run 走完 → 正常寫出;無缺陷紀錄、無摘要 | `[B11]` |
| B12 | token 選中缺陷案例但案例未執行 | 仍拋(只有實際記下缺陷者才豁免) | `[B12]` |
| B13 | 混合:缺陷案例 token+正常案例 token | 缺陷 token 豁免;正常案例未產 → 只列正常那個 | `[B13]` |
| B14 | 命中 compareOnly 案例 | 構造時拋(不變) | 既有 |
| B15 | ④token 且該案整案缺陷(未宣告 stages) | **已知限制**:不拋,摘要仍列該案 | `[B15]` |
| B16 | 孤兒圖與缺陷紀錄並存 | 孤兒仍拋,摘要先印;缺陷步舊凍結圖屬宣告 stages,不算孤兒 | `[B16]` |
| B17 | `--langs` 限縮 | 與缺陷紀錄無交集(語系過濾在構造期) | 既有語系測試 |
| B18 | 前段 token 配 `--write-mode missing`,檔已存在 | keep 仍算已產出(`noteProduced` 在 `decideWrite` 之前) | `[B18]` |
| B19 | `noteKnownDefect` 之 `keys` 型別 | 僅省略/`undefined`/`null`(整案)或圖鍵字串陣列(含空陣列)合法;其餘拋錯且不留紀錄(不把部分豁免擴大成整案) | `[B19]` |
| B20 | `finalize` 回傳 | 為獨立快照(`keys` 亦複製);輸入端 `keys` 亦於記錄時複製 | `[B20]` |
| B21 | 無語系前綴之 token 選中多語系/多案例 | **已知限制**:豁免與產出皆以 token 為單位(any-of),任一目標已產出或記缺陷即視為命中;帶語系前綴者各自獨立.與既有 `noteProduced` 同語意,非本次引入 | `[B21]` |
| B22 | 部分缺陷 + 未宣告 stages(經 `runBaselineCase`) | 前段 token 已產出而通過;點名缺陷步圖鍵(④)無法判定為缺陷,仍由 `finalize` 以未產出拋(與 B15 整案缺陷之寬鬆不同:前段已產出,缺漏的 token 較可能是拼錯);摘要註明「未列缺陷步圖鍵」 | `[B22]` |

### 2.2 規則

- `noteKnownDefect`:`keys` 三態——省略≡`null`(整案未產,豁免該案被選中之全部 token)、`[]`(部分缺陷但無缺陷步圖鍵可豁免,不覆蓋任何 token)、`[k…]`(僅豁免命中該鍵之 token);其餘型別拋錯.`filtered` 為假時只記錄.
- `finalize()`:有紀錄時先以 `log`(預設 `console.log`,傳 `null` 靜默)印摘要,再判未命中/孤兒;回傳 `{ knownDefects: [{lang,name,keys,message,ref}] }`(獨立快照;有問題時拋錯,不回傳).無冪等保證:每次呼叫皆重印摘要(設計如此,`finalize` 本只在全部案例跑完後呼叫一次).
- `describe()` 於跑案例前呼叫,不含缺陷紀錄;摘要一律在 `finalize`.

## 3. 單一擁有者

| 事項 | 唯一擁有者 | 說明 |
|---|---|---|
| 產製端寫檔迴圈(`shouldWrite → noteProduced → decideWrite → outPath → writeFile`、`[skip]/[keep]/[write]` 日誌) | `runBaselineCase` 之 `writeShots` | 正常與缺陷路徑共用 |
| 比對端逐張比對(含 `compareAll` 彙總) | `runBaselineCase` 之 `compareShots` | 同上 |
| 缺陷步圖鍵之宣告 | `runBaselineCase` 之 `defectStages`(對照 `stages`) | gate 的 `cases` 不另宣告缺陷步(缺陷是執行期性質) |
| 「哪些圖鍵因已知缺陷未產」之紀錄 | `gate.noteKnownDefect` | 由 `runBaselineCase` 自動呼叫;自寫包裝須自行呼叫 |
| 圖鍵三向核對 | `runBaselineCase`(部分缺陷路徑) | 正常路徑之 stages 檢查維持 K=S |
| 浮層框線外之圖形內容判定(svg 圖形、canvas 像素、宣告區) | `itemsUnionBox` 之頁內 `graphicAt`(及 `nearestOutside` 內之圖形掃描) | 舊規則 `legacyContentAt` 不動;兩者逐邊取較近者,退入規則兩套(見 §7.3) |

## 4. 已知限制

- B15:未宣告 `stages` 之案例整案缺陷時,④前綴 token(含拼錯者)無法驗證圖鍵,不拋;缺陷案例一律宣告 `stages`.
- B21:`produced`／`defectCovered` 皆為 token 層級(any-of):無語系前綴之 token 選中多語系/多案例時,任一目標已產出或記缺陷即視為命中,**其餘目標若根本未被執行不會被個別追蹤**(1.0.8 起 `noteProduced` 即如此,本次延伸至缺陷紀錄).要逐目標嚴格者,`--names` 項目帶 `<語系>-` 前綴並逐案點名;若日後要改為逐目標追蹤,屬 `finalize` 判定語意變更,須另案評估對既有使用者之影響.
- B22:部分缺陷 + 未宣告 `stages` 時缺陷步無從豁免(`out.defectStages=[]`,摘要註明未列缺陷步圖鍵);要豁免請宣告 `stages` 與 `defectStages`.
- 缺陷步之既有凍結標準圖(缺陷引入前產出者)保留於目錄、不再比對、不算孤兒(屬宣告 stages),修復後首次比對若失敗,依技能 §7.9 以差異範圍判定是否重產;套件不對其給提示.
- 缺陷為執行期動態判定、無到期日:缺陷清單(spec〈已知落差〉)須人工追蹤,套件只負責「修好後自動回到正常路徑」(B11).
- gate 的缺陷紀錄僅 `mode:'regen'` 由 `runBaselineCase` 通知;compare 端不傳 gate(gate 為產製端用).
- `defectStages` 必與 `stages` 併用;未宣告 `stages` 之案例不支援缺陷步豁免(整案缺陷不受影響).
- `semantic`/`verify` 自身拋未帶 shots 之 knownDefect 維持整案(不使用 `ctx.shots`).
- 提出方(cgsmdb)自寫包裝 `runCase` 未核對(審計時無法讀取);其遷移須改用套件並刪除包裝,掛鉤須以 `ctx.knownDefect` 分流.
- `itemsUnionBox` 圖形內容之已知限制 L1–L12 見 §7.4(框線四角 6×6、shadow DOM、`<use>`/`<image>`/marker、mask/filter、漸層透明段、巢狀 svg 視埠、pointer-events:none 之遮蓋、含旋轉翻轉變換之 canvas、WebGL/跨域/img/video、均勻大色塊、absolute 浮層、iframe).

## 4b. 對標(同類工具對「部分失敗保留已通過步驟」之慣例)

- Playwright Test：`test.skip()`／`test.fixme()` 為靜態宣告或執行中整測試停止、`step.skip()` 僅停止該步驟、soft assertion 繼續執行但先前失敗仍使測試失敗；jest-image-snapshot 於每次 matcher 呼叫時當下處理圖像並計數 added／updated／matched／unmatched.二者皆無「因已知缺陷未產圖」之分類或 gate 豁免(本審查者所引官方文件，未另行實測).
- 本設計取捨：①缺陷為執行期動態判定(修好即自動回正常路徑，優於靜態 skip；代價是無到期日)；②先收集 shots、過 `semantic`/`verify` 後才逐張處理(與逐步即時斷言時機不同；沿用本管線「全部斷言通過才寫檔」)；③前段不符就讓測試紅(不以 pending 掩蓋)，與 soft assertion 之「先前失敗仍使測試失敗」同向.

## 5. 破壞性變更紀錄

- **2026-10-30(e2e01,埠之監聽者查詢改委由 wsemi 1.9.32)**:不動標準圖像素.①`listenerPids`／`killPortListeners` 之 `opt.exec` 由 execSync 形改為 spawnSync 形 `(prog, args, { src, timeout, maxBuffer })=>{status,stdout,error}`(`killPortListeners` 之 `exec` 查詢與下殺共用);②移除 `parseListenerPids`(模組、入口鍵、測試); ③`[]` 語意收緊為「已確認無人」,`null` 涵蓋更多失敗; ④新增選項 `listenerPids` 之 `timeout`／`useBoth`／`onTrace`、`killPortListeners` 之 `timeout`(查詢固定 `useBoth:true`); ⑤新增依賴 `wsemi`.規則與測試對照見 `sgud/rule/rulebook_port.md`;README §5 Breaking changes.
- **2026-10-20(issue #6)`itemsUnionBox` 圖形內容**:無 API 不相容變更;`graphics` 預設開啟屬會動使用端標準圖像素之框幾何類變更(§7.5),`graphics:false` 為逃生口.本節以下三點為 issue #4/#5 之紀錄.
- 無破壞性變更.**唯一語意變更**:`createKnownDefect(msg, { shots })` 於 1.0.8 靜默忽略 `shots`,此後生效(帶 shots 而無 `defectStages` 時,`stages` 已宣告者以 D=∅ 核對,不完整即大聲失敗).
- 行為補充(非破壞):`gate.finalize()` 回傳值由 undefined 改為 `{ knownDefects }`;有缺陷紀錄時多印摘要;`createBaselineGate` 新選項 `log`;整案缺陷 + `--names` 之離開碼由 1 改 0.
- 未帶新參數者:`runBaselineCase` 之日誌、`out` 欄位集合、`status`、`onKnownDefect` 時序不變.不動標準圖像素、框幾何、截圖序列、launch 旗標,使用端不需重產.

## 6. 對應測試與指令

- `test/unit-runBaselineCase.test.mjs` 之 `describe('runBaselineCase 部分已知缺陷…')`:表 A(測試標題前綴 `[A..]` 對應列號).
- `test/unit-baselineGate.test.mjs` 之 `describe('createBaselineGate 已知缺陷紀錄…')`:表 B(前綴 `[B..]`).
- `test/e2e-itemsUnionBoxGraphics.test.mjs`:表 C(§7.2;前綴 `[ID]`,真 Chromium,語意/幾何斷言,無標準圖).單檔自編 `npx mocha test/e2e-itemsUnionBoxGraphics.test.mjs --no-parallel --timeout 180000`;既有 `test/e2e-captureEquivalence.test.mjs` 之 `itemsUnionBox` 7 條為舊規則之契約,須維持全綠.
- 全套:`node C:/opensrcOper/tools/quiet-run.mjs --name final -- npm test`(`mocha --no-parallel "test/*.test.mjs" --timeout 180000`);單檔自編 `npx mocha test/unit-runBaselineCase.test.mjs test/unit-baselineGate.test.mjs --no-parallel --timeout 60000`.
- lint:`npx eslint --ext .mjs src tools test` 須 0 error.
- `test/unit-procPrimitives.test.mjs` 之 `listenerPids`／`killPortListeners`(前綴 `[LP*]`、`[KP*]`、`[RP*]`)對應 `sgud/rule/rulebook_port.md`;單檔自編 `node C:/opensrcOper/tools/quiet-run.mjs --lock --name x -- npx mocha --no-parallel test/unit-procPrimitives.test.mjs --timeout 180000`(`[R*]` 用固定埠 19050、19051,須空閒).
- 使用端視角:`npm pack` 後安裝至 `./tmp` 假專案深層引用實跑(見 `sgud/proc/process.md`「改動 src/ 之驗證範圍」).
## 7. itemsUnionBox 圖形內容(Gitea issue #6;2026-10-20 審計 run01、修正 run02)

編列依據:issue #6(cgsmdb:浮層疊在 Highcharts svg 圖表上,框線蓋到資料波形)之審計(`agent-out/run01-審計回應.md`、主控複審 `review/run01-複審.md`)與修正.API 細節見 `README.md` §1.1 `itemsUnionBox` 列與 JSDoc;取捨緣由見 `sgud/exp/experience.md`「注意事項: 紅框」.

### 7.1 軸與縮減

| 軸 | 成員數 | 成員 |
|---|---|---|
| A 浮層下方內容型別 | 12 類(子類見 §7.2) | 無 / 純色大 HTML 容器 / HTML 文字與有邊界元素 / svg 各圖形元素(7 種)/ svg 文字 / svg 底色與同色形狀 / svg `use`、`image`、`marker` / canvas 2d(透明、不透明、均勻半透明、紋理)/ canvas 變換、WebGL、跨域 / img、video / 宣告區 / CSS 背景圖 |
| B 可見性 | 14 類 | 可見 / stroke alpha 0 / stroke-opacity 0 / opacity 0(自身、祖先、累積 < 0.1)/ display none / visibility hidden / stroke 與 fill 皆 none / stroke 寬 0 / clip-path 裁掉 / overflow 裁掉 / defs 內 / 遮罩後 / 不透明層蓋住 / 透明攔截層 |
| C 位置 | 36 | 距矩形邊間隙 g = 0(緊鄰守距列)、1、2、5(帶內)與 6、8、12、30(帶外)× 四向(上下左右)= 32,加四個角落 = 36;32 格皆有測試(下向:D01–D04、K01、K02;上/左/右:N06),四個角落為已知限制(L1) |
| D 選項 | 8(有效 4) | `fit` true/false × `graphics` true/false × `graphicAreas` 無/宣告(`fit:false` 時後兩者無作用) |
| E 浮層結構 | 5 | fixed 本身 / 透明外層 + 面板 / 面板大於外層 / 浮層含自身 svg / absolute 浮層 |
| F 頁面狀態 | 3 | 一般 / 已捲動 / 浮層貼視窗角落 |
笛卡兒積約 12×14×28×8×5×3 ≈ 56 萬格,絕大多數不可達或重複(例:不可見性只對 svg 圖形有意義、方向對稱);依可達性縮為下表之**格類**,每格類至少一條實測。狀態:**紅** = 修前紅(對 1.0.9 失敗、對原型通過)、**釘** = 修前綠(防回歸,對兩版皆通過)、**限** = 已知限制/不修(§7.4)、**略** = 刻意不做、**探** = 以探測腳本實測(未入 mocha)。

### 7.2 表 C:格類(1.0.9 實測 → 修後預期 → 測試)

測試檔 `test/e2e-itemsUnionBoxGraphics.test.mjs`,標題前綴 `[ID]` 對應下表.狀態:**紅** = 修前紅(對 1.0.9 失敗、對修正後通過)、**釘** = 修前綠(防回歸)、**限** = 已知限制(§7.4)、**略** = 刻意不做、**探** = 以探測腳本實測(未入 mocha,腳本見 run01/run02 附件).

| ID | 內容型別 | 可見性/位置/其他 | 1.0.9 | 修後預期 | 測試 | 狀態 |
|---|---|---|---|---|---|---|
| C01 | 無內容 | — | 外擴 | 同 | `[C01]` | 釘 |
| C02 | 純色大 HTML div(> 480) | — | 外擴 | 同 | `[C02]` | 釘 |
| C03 | HTML 文字、晶片、有邊界元素 | 舊規則 | 退入/夾邊 | 同 | `e2e-captureEquivalence` 29 條 | 釘 |
| C04 | svg `path` stroke 1px | 下 2px | 蓋住 | 退入 | `[C04]` | 紅 |
| C05 | svg `line` 1.5px | 同 | 蓋住 | 退入 | `[C05]` | 紅 |
| C06 | svg `polyline` | 同 | 蓋住 | 退入 | `[C06]` | 紅 |
| C07 | svg `polygon` fill | 同 | 蓋住 | 退入 | `[C07]` | 紅 |
| C08 | svg `rect` fill(長條) | 同 | 蓋住 | 退入 | `[C08]` | 紅 |
| C09 | svg `circle` 標記列 | 同 | 蓋住 | 退入 | `[C09]` | 紅 |
| C10 | svg `text`(可命中) | 同 | 退入(舊規則) | 同 | `[C10]` | 釘 |
| C11 | svg `text` pointer-events:none | 同 | 蓋住 | 退入 | `[C11]` | 紅 |
| C12 | svg 群組 `transform` | 同 | 蓋住 | 退入 | `[C12]` | 紅 |
| C12b | svg 於 CSS `scale(1.5)` 祖先 | 同 | 蓋住 | 退入 | `[C12b]` | 紅 |
| C12c | 巢狀 svg | 同 | 蓋住 | 退入 | `[C12c]` | 紅 |
| C13 | 透明追蹤線疊在真線上 | 同 | 蓋住 | 退入 | `[C13]` | 紅 |
| C14 | `pointer-events:none` 之線 | 同 | 蓋住 | 退入 | `[C14]` | 紅 |
| C15 | svg 撐滿底色 rect(白) | — | 外擴 | 同 | `[C15]` | 釘 |
| C15b | svg 撐滿底色 rect(有色 #e8eef8) | — | 外擴 | 同 | `[K13]` | 釘 |
| C15c | 與背後同色之形狀(白 path/polygon、白 rect 40%、#fafafa) | — | 外擴 | 同 | `[K03]`(4 小項) | 釘 |
| C16 | svg 根 opacity .5(累積 ≥ 0.1,仍可見) | 同 | 蓋住 | 退入 | `[C04b]` | 紅 |
| C17-1…12 | 不可見:stroke alpha 0、stroke-opacity 0、opacity 0、祖先 opacity 0、根 opacity .05、display none(圖形)、display none(根)、visibility hidden、stroke+fill none、stroke 寬 0、clip-path 裁掉、defs 內 | 同 | 外擴 | 同 | `[C17]` ×12 | 釘 |
| C18 | stroke 為不透明漸層 url(#g) | 同 | 蓋住 | 退入 | `[C18]`、`[K04]` | 紅 |
| C18b | fill/stroke 參考不存在之 url、全透明漸層(3 小項) | 同 | 外擴 | 同 | `[K04]` | 釘 |
| C19 | svg `<use>` 引用之線 | 同 | 蓋住 | 不判 | `[G09]` | 限(L3) |
| C19b | svg `<image>` | 同 | 蓋住 | 預設不判;`graphicAreas:'svg image'` 退入 | `[G09]` | 紅 |
| C19c | `marker-mid`、mask、filter、漸層透明段、巢狀 svg 視埠 | 同 | — | 不處理 | — | 限(L3–L6) |
| C20 | svg 文字被透明 HTML 層蓋住 | 同 | 蓋住 | 退入 | `[K07]` | 紅 |
| C21 | canvas 2d 透明底 + 線 | 下 2px | 蓋住 | 退入 | `[G01]` | 紅 |
| C22 | canvas 2d 不透明白底 + 線 | 同 | 蓋住 | 退入;無線同外擴 | `[G02]`(2 小項) | 紅 |
| C23 | canvas 2d 空白 | — | 外擴 | 同 | `[G03]` | 釘 |
| C24 | canvas 2d 紋理(地圖式色塊) | — | 外擴 | 四邊退入 | `[G04]` | 紅 |
| C25 | canvas 均勻半透明底(.9、.5)、白底占 70% 加透明邊 | — | 外擴 | 同 | `[K09]`(3 小項) | 釘 |
| C26 | canvas 含 `scaleY(-1)` | 同 | 蓋住 | 預設不判;宣告退入 | `[K12]` | 紅 |
| C27 | canvas WebGL | 同 | 蓋住 | 預設不判;宣告退入 | `[G05]` | 紅 |
| C28 | canvas 跨域污染 | 同 | 蓋住 | 不拋錯、不判 | `[G06]` | 釘 |
| C29 | canvas 祖先 opacity 0、祖先 overflow 之外 | 同 | 外擴 | 同 | `[K08]`(2 小項) | 釘 |
| C30 | 未建立 context 之 canvas | — | 量後仍可取 webgl | 同 | `[K10]` | 釘 |
| C31 | `<img>` | 同 | 蓋住 | 預設不判;宣告退入 | `[G07]` | 紅 |
| C32 | 宣告區位於浮層內/被遮罩蓋住/為面板內 img | — | — | 不算 | `[G08]`、`[J03]` | 釘 |
| D01–D03 | svg 線 | 下方間隙 0(緊鄰守距列)、2、5px(帶內) | 蓋住 | 退入 | `[D01]`–`[D03]` | 紅 |
| D04 | svg 線 | 下方間隙 6、8、12、30px(帶外) | 外擴 | 同(逐位元) | `[D04]` ×4 | 釘 |
| D05 | svg 線 | 上、左、右(2px) | 蓋住 | 退入 | `[D05]`(3 小項) | 紅 |
| D06 | 線只在浮層右半下方(文字範圍之外) | — | 蓋住 | 退入 | `[D06]` | 紅 |
| D07 | 水平線緊貼浮層下緣、橫向延伸過左右側 | — | 外擴 | 只退下緣,左右不縮 | `[D07]` | 釘 |
| D08 | 框線四角 6×6 內之孤立圖形 | — | 蓋住 | 不處理 | — | 限(L1) |
| K01 | 1px 細線落在像素格線上 | 下垂直線欄 301–304、右水平線列 151–154 | 蓋住 | 皆退入 | `[K01]`(8 小項) | 紅 |
| K02 | 框線帶之界 | 下:間隙 5(帶內)/6、7(帶外);右:欄 425/426 | 帶內蓋住 | 帶內退入、帶外同無內容 | `[K02]`(5 小項) | 紅 |
| J01 | 0.6px 細線落在像素邊界 | — | 蓋住 | 退入 | `[J01]` | 紅 |
| L01 | 退入位置 | 四邊 | — | 外緣距內容恰 1px | `[L01]`(4 小項) | 紅 |
| L02 | 浮層內距 2px(放不下描邊) | — | — | 取間隙正中 | `[L02]` | 紅 |
| L03 | 浮層比文字寬,右側線緊貼浮層邊 | — | 蓋住 | 右緣仍近浮層邊(不縮到文字) | `[L03]` | 釘 |
| E01 | 圖形在淡底全畫面遮罩後 | — | 外擴 | 同 | `[E01]` | 釘 |
| E02 | 圖形在透明點擊攔截層後 | — | 蓋住 | 穿透、退入 | `[E02]` | 紅 |
| E03 | 圖形被不透明 div 蓋住 | — | 外擴 | 同 | `[E03]` | 釘 |
| E04 | 浮層自身含大 svg | — | 外擴 | 同 | `[E04]` | 釘 |
| E05 | 面板大於 fixed 外層、線在面板下方內距 | — | 外擴 | 同 | `[J02]` | 釘 |
| E06 | 浮層自身之 svg(pointer-events:none,在面板盒外) | — | 外擴 | 同 | `[J05]` | 釘 |
| E07 | 透明面板(無底色)大於 fixed 外層、線在面板內距內 | — | 外擴 | 同 | `[K14]` | 釘 |
| N01 | 圖形夾到沒有尺寸(窄浮層寬 4、5、6px + 右側緊鄰晶片 + 左側線) | — | 只避晶片 | 只撤銷圖形之夾制,同 `graphics:false`(不連 HTML 規則之避讓一併撤銷) | `[N01]`(3 小項) | 釘(對 1.0.9 綠;對外審前原型紅) |
| N02 | 跨域污染 canvas 在前、乾淨 canvas(含線)在後 | 下 2px | 蓋住 | 退入(各 canvas 自有離屏畫布) | `[N02]` | 紅 |
| N03 | 遮蓋雙向:透明 canvas / opacity:0 之白底層蓋在線上;他根、同根居後之不透明 svg 遮片蓋住線 | 下 2px | 蓋住/外擴 | 前二者退入(穿透)、後二者同無內容 | `[N03]`(4 小項) | 紅 |
| N04 | 裁切以實際命中點確認:canvas、`graphicAreas` 被 clip-path 裁掉;clip-path 內 0.6px 細線 | — | 外擴/蓋住 | 前二者同無內容、細線退入 | `[N04]`(3 小項) | 紅 |
| N05 | 沿邊取樣之界:貼矩形左緣(欄 300)、右緣(欄 419)之下方垂直線;浮層上緣 150.5 / 左緣 300.5 時帶端點所在列/欄 | — | 蓋住 | 退入 | `[N05]`(4 小項) | 紅 |
| N06 | 四向對稱(上/左/右):g = 0、1、2、5 退入;g = 6、8、12、30 同無內容 | — | 蓋住/外擴 | 退入/同(逐位元) | `[N06]`(3 向 × 8) | 紅 |
| N07 | 框矩形內(inkPad 區)之線:文字目標(浮層末項,無內距)下方 1–3px;文字目標(寬貼合文字)上/下/左/右各距文字 1–3px 之短線 | — | 外擴 | 同 `graphics:false`(不介入,不使框線內緣越過文字;四向起點一致) | `[N07]`(3 小項)、`[N07b]`(4 向 × 3) | 釘(對 1.0.9 綠;對外審前原型紅) |
| N08 | 黑底圖表:白條、白線算;黑條同底色不算 | 下 2px | 蓋住/外擴 | 白條、白線退入;黑條同無內容 | `[N08]`(3 小項) | 紅 |
| N09 | svg 文字逐文字節點判可見:外層 none + tspan 有色、純描邊算;tspan opacity 0 / fill none 不算 | — | 蓋住/外擴 | 如左 | `[N09]`(4 小項) | 紅 |
| N10 | 現代色彩:`color(display-p3 … / 0)`、`oklch(… / 0)`、`lab(… / 0.05)` 不算;不透明 P3 算;`color(srgb 1 1 1)` 白條在白底不算 | — | 蓋住/外擴 | 如左 | `[N10]`(6 小項) | 紅 |
| N11 | canvas 位圖只畫在內容盒:border 10 + padding 20;`object-fit:contain` | — | 蓋住 | 換算後退入 | `[N11]`(2 小項) | 紅 |
| N12 | 粗描邊(484px 寬,中心在視窗外 y=460,幾何外接框離候選範圍遠;預篩預留 200px) | — | 蓋住 | 退入 | `[N12]` | 紅 |
| N13 | 面板遠大於 fixed 外層(0x0 外層 + absolute 面板,面板下緣離外層 > 64px) | 面板高 +0、+40、+120 | 蓋住 | 退入 | `[N13]`(3 小項) | 紅 |
| N14 | 遠離浮層之大 svg 根以樣式表規則(class)宣告 `overflow:visible` | — | 蓋住 | 退入 | `[N14]` | 紅 |
| N15 | 撐滿圖表之全幅底色 rect 以半透明有色(alpha .2)、漸層填色 | — | 外擴 | 同(底色規則不依賴「不透明且同圖表底色」) | `[N15]`(2 小項) | 釘 |
| F01 | `fit:false` | — | 量元素本身 | 同 | `[F01]` | 釘 |
| F02 | `graphics:false` | — | — | 逐位元同 1.0.9 | `[F02]` | 釘 |
| F03 | 預設(不給旗標) | — | 蓋住 | 退入 | `[F03]` | 紅 |
| F04 | `graphicAreas` 非法(空字串、非字串、含空白項) | — | 無此選項 | 拋錯 | `[G10]` | 紅 |
| H01 | 透明 fixed 外層 + 有底色面板 | 下方有線 | 蓋住 | 退入 | `[H01]` | 紅 |
| H02 | HTML 晶片(右側)+ svg 線(下方) | — | 只避晶片 | 兩者皆避 | `[H02]` | 紅 |
| H03 | 頁面已捲動 100px | — | 蓋住 | 退入 | `[H03]` | 紅 |
| H04 | `position:absolute` 浮層 | — | 外擴 | 同(不在範圍) | `[H04]` | 限(L11)+釘 |
| H05 | 浮層貼視窗左上角、不繪製容器之零矩形落入範圍 | — | 外擴 | 同 | `[J04]` | 釘 |
| H06 | 祖先 overflow 裁掉:hidden 容器、auto 捲動容器;未裁掉者 | — | 外擴/蓋住 | 裁掉者同無內容、未裁者退入 | `[K05]`(3 小項) | 釘+紅 |
| H07 | 大 svg 根宣告 `overflow:visible` 而內容畫在根框外(根在近旁、根遠離) | — | 蓋住 | 退入 | `[K06]`、`[K06b]` | 紅 |
| M01 | 隨機 80 頁(固定種子)無大型圖形 | `graphics` true/false | — | 量框逐位元相同(且舊規則於其中確有介入 ≥ 20 次,非空轉) | `[M01]` | 釘 |
| I01 | 取樣成本:無圖形頁、近旁有 400 個小 svg 圖示 | — | — | `elementsFromPoint` 次數同 1.0.9 | `[I01]`、`[K11]` | 釘 |
| I02 | dbg 輸出 | `E2E_BOX_DEBUG=1` | 無 graphic 欄 | 有 `graphic.bottom` | `[I02]` | 紅 |
| P01 | 真 Highcharts/Plotly/ECharts 掃描(7 組、360 位置;外審修正後重跑) | — | 265 處蓋住 | 0 處(含框線四角) | `verify/realcharts.mjs` | 探 |
| P02 | 對抗審查之 30 餘個反例場景 | 見 run01 審計回應 §6 | — | — | `review/r1`–`r7` | 探 |
| P03 | 隨機差分 plain(2 種子 × 400 頁 × 2 目標,無大型圖形) | — | — | 現行 vs 1.0.9 差異 0、graphics true/false 差異 0(各 800 次量測;舊規則介入 448、457 次,非空轉) | `verify/differential.mjs … plain` | 探 |
| P04 | 隨機差分 graphics(2 種子 × 500 頁 × 2 目標,含隨機大 svg/canvas 圖表) | — | — | `graphics:false` vs 1.0.9 差異 0(2000 次量測);`graphics:true` 之量框皆為 `false` 之子集(非子集 0);圖形規則介入 159、207 次 | `verify/differential.mjs … graphics` | 探 |
| P05 | 變異驗證(54 個變異體) | — | — | 殺死 53;存活 1(M12 等價:宣告區在浮層內由命中堆疊之浮層自身蓋住判定重複防線) | `verify/mutate.mjs` | 探 |
| X01 | 以對比度門檻排除淺灰格線 | — | — | 不做:淺灰格線亦算內容(但只在框線帶內才介入,影響小) | — | 略 |
| X02 | 以截圖像素判定 svg/canvas | — | — | 不做:浮層陰影污染且量測期不得改動頁面 | — | 略 |
| X03 | 圖形取樣沿用 `inner` 範圍 | — | — | 不做:資料線橫貫下緣右半時掃不到 | — | 略 |
| X04 | 改動 HTML 鄰項之取樣範圍 | — | — | 不做:範圍外,會動既有標準圖 | — | 略 |

### 7.3 規則

- **只增不減**:舊規則(`legacyContentAt`,即 1.0.9 之 `contentAt` 本體,逐字不改)回非 `null` 之點結果不變;圖形規則另行掃描(`graphicAt`),逐邊取較近者.`graphics:false` 逐位元重現 1.0.9(測試 `[F02]`、`[M01]`).
- **最小介入**:圖形只在框線帶(目標矩形邊外 1 至 `BOX_PAD`(6)px,另含緊鄰矩形邊之一列/行作守距)內有墨跡時才改框,不沿用舊規則另留之 2px(`lim`);**框矩形內(含 inkPad 區)之內容框線蓋不到,不介入**(否則退入後框內緣越過文字);沿矩形邊全長逐 px 取樣,**四向同一算法**:下/右掃像素列(行) y 自 `floor(邊)` 至 `< 邊+6`,上/左自 `ceil(邊)-1` 至 `≥ floor(邊-6)`(邊為小數時帶端點所在列/欄也掃),沿邊取 `floor(起)` 至 `ceil(終)-1` 全部像素欄(列),含首末欄;框線四角 6×6 不掃(L1).守距列用意:與框線內緣相切之內容不被蓋住,但貼著浮層側邊、伸到浮層下方之柱/軸(縱向內容)在角落處與框線相交,由此一列攔下.
- **候選範圍**:浮層外層矩形與框矩形之聯集外擴 64px(取整至 128px 格,同範圍之多個目標共用候選清單);面板可大於 fixed 外層(0x0 外層包 absolute 面板),框矩形不在外層矩形內,故須計入.svg 圖形外接框不含線寬,預篩預留 200px 後以線寬重算精確範圍複核(線寬 > 400px 者不認).
- **補舊規則之盲區**:只納入大 svg 根與大 canvas(寬 > 480 或高 > 120);小者舊規則已以整個元素框為內容(`hasBoundary`).`overflow:visible` 之 svg 根(屬性或行內樣式宣告)不論大小皆收.
- **svg 以幾何判定,不用命中測試**:`getScreenCTM` 反矩陣 + `isPointInStroke/isPointInFill`;取樣足跡為像素中心與其上下左右距中心 0.45px 之 4 點(皆在本像素內;含像素邊界點會使緊貼浮層邊之平行線誤退鄰邊).
- **可見性**:display/visibility;累積 opacity ≥ 0.1;stroke 寬 > 0 且 alpha×stroke-opacity×累積 opacity ≥ 0.1,fill 同式;`url(#id)` 參考不存在或漸層色標全透明視同 none.顏色另以專用解析器(`gColor`)處理:`rgb()/rgba()`、`color(srgb …)` 取色與 alpha,其餘現代色彩空間(`color(display-p3 …)`、`lab()`、`oklch()`)只取「/ alpha」,不當不透明黑.**底色不算內容**:面積 ≥ 根面積 50% 之 `rect`(任何色)、填色與圖表底色相同者(合成色差 ≤ 8/通道;圖表底色 = 最上層撐滿且不透明之 `rect` 之色,無則取根之祖先底色——黑底圖表上之白條算內容);其 stroke 仍算.**裁切**:祖先 overflow 非 visible 者之矩形(HTML 元素與外層 svg 根)交集外不算;clip-path 者能命中測試(`pointer-events` 非 none)以命中堆疊確認於**實際命中之取樣點**(細於 1px 之線在像素中心不命中);canvas、宣告區之 clip-path 同確認;大 svg 根是否 `overflow:visible` 另取計算樣式(樣式表規則宣告者).**遮蓋**:命中堆疊中排在圖形或其祖先之前者視為蓋住,條件——有底色(alpha × 累積 opacity > 0.05)/背景圖/替換元素(img、video、iframe)、位圖在該點不透明之可讀 canvas(不可讀者保守視為蓋住;透明 canvas 穿透)、不透明填色(≥ 0.9)之 svg 圖形(白色遮片:圖形在堆疊內者以堆疊順序判,含他根之遮片;不在堆疊內者僅認同一 svg 內文件順序居後者);累積 opacity < 0.1 之層與透明層穿透;浮層自身蓋住之點不算.**命中堆疊取樣**:HTML 方塊用整數座標 `(x, y)`(實測 `elementsFromPoint` 對 HTML 方塊之命中區為 `[x, x+1) × [y, y+1)`,小數座標如 `x+0.5` 會把右/下一像素之元素也算進來,如緊貼浮層左緣之柱被判成浮層蓋住),svg 圖形另以實際命中之取樣點取精確幾何堆疊.文字取各文字節點之 `Range` 字行框(同 `textRectAt`),依該節點所屬元素(text 或 tspan)自身之 fill/stroke/opacity 判可見(外層 `fill:none` 但 tspan 有色算、純描邊算),不依賴命中測試.
- **2d canvas**:以 `drawImage` 分塊(64×64)取至離屏小畫布讀像素,**不對來源呼叫 `getContext`**(否則從未繪製之 canvas 會被建立 2d context 而使其後之 webgl 失效);**每個 canvas 各用一張離屏畫布**(跨域污染之 canvas 會污染其離屏畫布,共用則其後所有 canvas 讀不到);alpha < 40 不算墨跡;各像素所在 16×16 小格之眾數色為透明者以 alpha 判定,否則以與眾數色之色差/alpha 差 > 24 判定(均勻大色塊視為背景);位圖只畫在**內容盒**(扣 border 與 padding),`object-fit` 為 fill 以內容盒對位圖縮放、contain/cover/none/scale-down(object-position 置中者)依縮放與置中位移換算,留白處無像素;含旋轉/翻轉/斜切 CSS 變換者、object-position 非置中者、跨域污染者不自動判定.
- **`graphicAreas`**(選擇器字串或陣列):命中元素之矩形(與其祖先 overflow 裁切範圍之交集)整區視為內容;位於浮層內、被遮罩蓋住者不算;非空字串檢查.img/video/WebGL/跨域 canvas/地圖/熱圖須以之宣告.
- **兩套退入規則**:HTML 鄰項取「文字與鄰項間隙正中」(舊);圖形取「框線外緣退到內容前 1px(剛好不蓋)」,框內緣不越過文字(≥ 文字邊 − 1),放不下 5px 描邊時退回間隙正中.理由:圖形遍布繪圖區、浮層又常比其文字寬得多,取正中會使框縮到只剩文字範圍.圖形夾制使框夾到沒有尺寸(寬或高 < 1)時,只撤銷圖形之夾制、保留 HTML 規則之結果(不連 HTML 避讓一併退回未夾之矩形).橫貫左/右框線帶之水平線(線在矩形各列範圍內)無從以移動左右緣避開——左右緣退入浮層內側(使框線帶落在不透明之浮層上、不蓋圖形),屬設計行為.
- 頁內函式內之例外一律吞掉並視同無圖形內容(不得比 1.0.9 更糟).`E2E_BOX_DEBUG=1` 之輸出增 `graphic`(邊 → 命中描述@視窗座標).

### 7.4 已知限制(接受,README 明列)

| # | 限制 | 方向 | 以 `graphicAreas` 可改以宣告處理 |
|---|---|---|---|
| L1 | 框線四角 6×6 小方格內之孤立圖形(完全落在角落、與四邊之掃描帶及緊鄰守距列皆不相交者) | 漏蓋(至多數 px²) | 否 |
| L2 | shadow DOM 內之 svg/canvas | 漏蓋 | 否(可日後遍歷 open shadow root) |
| L3 | `<use>` 引用之圖形、`<image>`、`marker`(含 `marker-mid` 圓點) | 漏蓋 | `<image>` 可(`svg image`) |
| L4 | `mask`、`filter`、CSS `filter` 使圖形不可見者仍視為可見 | 多退(不少退) | — |
| L5 | 漸層填色之透明段整體視為可見 | 多退 | — |
| L6 | 巢狀 svg 之視埠裁切 | 多退 | — |
| L7 | 被 `pointer-events:none` 之不透明元素蓋住之圖形(命中堆疊看不到該遮蓋) | 多退 | — |
| L8 | 含旋轉/翻轉 CSS 變換之 canvas、`object-position` 非置中之 object-fit canvas | 漏蓋 | 可 |
| L9 | WebGL canvas(僅 `preserveDrawingBuffer:true` 者讀得到像素,其餘讀得空白)/跨域污染 canvas、`<img>`、`<video>`;位於圖形上方之不可讀 canvas 保守視為蓋住其下之圖形 | 漏蓋 | 可 |
| L10 | 面積 ≥ 50% 之 `rect` 一律視為底色(含有色者);canvas 之均勻大色塊(地圖多邊形內部、熱圖大色格)視為背景 | 漏蓋 | 可 |
| L11 | `position:absolute` 浮層(舊限制,與本案無涉) | 漏蓋 | — |
| L12 | iframe 內之圖表 | 漏蓋 | — |

### 7.5 變更紀錄

- 新增選項 `graphics`(預設 true)與 `graphicAreas`;預設開啟屬**會動使用端標準圖像素之變更**(框幾何類):fixed 浮層之框線帶內有 svg 圖形/可讀 2d canvas 墨跡/宣告區者,框線改退入;`graphics:false` 逐位元重現 1.0.9.其餘(無圖形、框線帶外、小 svg/canvas、`fit:false`)不變,以隨機差分與既有 29 條等價測試證明.非 API 不相容變更.
