# 規則帳本:全量執行之共用層支援(收集模式、有變更才改寫、埠位移;§8)

編列依據:Gitea issue #19(提出方 rddmanager,2026-10-28)之修正 pte2e-run01.API 細節見 `README.md` §2.8～§2.10 與各檔 JSDoc;取捨緣由見 `sgud/exp/experience.md`「注意事項: 產製與比對」「生命週期與行程」之 issue #19 各條.

## 8.1 軸

| 功能 | 軸 | 成員 |
|---|---|---|
| 收集 | 呼叫路徑 | 範圍外直呼 `assertBaselineMatch`;`collector.run` 範圍內直呼;`runBaselineCase` run 內;`runBaselineCase` 案例末 `compareShots`;案例末自訂 `match` 拋其他錯 |
| 收集 | 啟用來源 | 未設;`E2E_COLLECT=1`;`opt.collect` true／false;收集器物件 enabled／disabled |
| 收集 | 比對結果 | pass;pass＋headroom;diff;size;missing;PNG 解碼錯 |
| 收集 | 案例結局 | 全通過;semantic／verify／run 內一般錯／stages 不符;整案已知缺陷;部分已知缺陷;setup 錯;afterCase 另拋錯;清單／日誌本身失敗 |
| 收集 | 模式 | compare;regen(互斥);巢狀於外層收集範圍內之 regen／collect:false 之 compare |
| 收集 | 範圍壽命 | run 期間;run 結束後遺留之非同步工作;範圍外傳入之收集器物件 |
| 收集 | 證據落點 | 單一目錄;多目錄;跨行程同毫秒同標籤 |
| 有變更才改寫 | 啟用 × 上限 × 標準圖狀態 | 未設／'1'／其他值 × 未設／0／N／非法 × 不存在／RGBA 同／RGBA 異計數 0／≤N／>N／尺寸不同;transient 是否;compareBuf 有無;gate 與 outDir;正常／部分缺陷／compareOnly 路徑 |
| 埠位移 | offset × 組埠處 | 未設／''／'0'／N／非法／溢位 × svc.url(預設／字串同埠／字串異埠／函數)、probe、spawn、beforeSpawn、就緒訊息、日誌、restart killListeners、portOf |
| 審查採用 | 證據 × 清單 × accept 條件 | diff 三件／size 二件／missing 一件／非收集證據／壞 PNG × mismatch／failed／無／衝突 × 未給／空／未知／failed／無路徑／過期(兩種)／同一目的地／壞 PNG／dryRun／since／他目錄執行／root／正常;裁圖目錄與既有檔撞名 |

## 8.2 規則

1. 三項皆預設關閉;未設選項與環境變數時行為與 1.0.10 逐位元一致(差分腳本 32 組＋既有測試;唯一新增:`spawn`／`beforeSpawn` 參數物件之 `port` 鍵、回傳之 `portOf`).
2. 收集只發生在案例範圍內(`createBaselineCollector().run` 或 `runBaselineCase` 收集模式);`assertBaselineMatch` 不讀環境變數;範圍外照常立即拋錯.
3. 彙整錯誤首行格式固定:`截圖與標準圖不一致 ×<不符>/<比對> [<案例鍵>]: <標籤>(<N>px|尺寸不同|缺標準圖|比對錯誤), ...`;錯誤物件帶 `baselineCollect.records`(含通過者).改格式屬破壞性變更(使用端判讀程式依此解析).
4. 其他錯誤原樣拋出、不改訊息;已收集之不符以 `[baseline-collect]` 一行、`err.baselineCollect`、案例清單 `outcome:'failed'` 呈現.
5. 收集到不符時不呼叫 `onKnownDefect`.
6. 收集模式與產製模式互斥(`runBaselineCase` 開瀏覽器前、`getE2eMode` 之 guard).
7. 標準圖寫檔只經 `runBaselineCase` 之 `writeShots` → `writeBaselineIfChanged`;未啟用即直接寫、不讀標準圖.
8. 有變更才改寫之判定用比對端同一覆蓋(`compareBuf`)與容差(`maxDiffPixels`／`threshold`);`KEEP_MAXDIFF=0` 以 RGBA 逐像素相同為準;寫出者為當次截圖本身.
9. 暫時狀態圖由專案以 `transient` 宣告;啟用時既有者不改寫.
10. 實際埠＝基準埠＋`E2E_PORT_OFFSET`;套件內組埠處只有 `createServiceManager`,全數用實際埠;收完整網址／埠之原語不另位移.
11. 字串 url 之埠不等於基準埠且有位移時拋錯(不靜默探測他實例).
12. 採用只處理明列標籤,先全部驗證再複製;`failed`、清單衝突、過期、壞 PNG、同一目的地、無路徑、無證據(含 since 之前)皆拒收;未給標籤即拋錯.
13. 收集範圍只在 `run` 執行期間有效(`open`);範圍外傳入之收集器物件與 run 結束後之遺留工作皆不收集(外審 F1、F2).
14. 外層有啟用之收集範圍時,`runBaselineCase` 產製端拋錯;未啟用收集之比對端遮蔽外層(F3).
15. 已知缺陷路徑之彙整延到收尾之後(`deferIfMismatch`);收尾另拋錯者以之為準、清單 failed(F4).清單／日誌本身失敗不取代原錯誤(F5).
16. 有「比對錯誤」之案例清單 outcome 為 failed(F13);清單寫入每個證據目錄(F14);證據 capture 與清單皆排他建立(F16).
17. 未啟用有變更才改寫時寫檔同步(時序同 1.0.10)(F9);啟用時配自訂 match 須明給容差(F11);`--write-mode changed` 之容差判定由有變更才改寫取代(F12).
18. `spawn`／`beforeSpawn` 之 `port`、管理器之 `portOf` 為不可列舉屬性(可列舉形狀同 1.0.10)(F8);字串 url 之協定預設埠視為 80／443(F20).
19. 相對標準圖路徑預設以比對時之 cwd 解析,`root` 明給者以之(F18);裁圖排他建立永不覆蓋(F21).
20. 案例末比對錯誤(含解碼失敗、pathOf／labelOf 拋錯)記錄並續比,標籤取不到以 `<lang>-<圖鍵>`,每張只呼叫一次 labelOf(F6、F22、G14);自訂 match 正常回傳者補記 pass,以單張比對之標記判定(F10、G5).
21. 每次 run 有序號,作用中收集器＝範圍物件之收集器且其 `runId` 等於範圍序號;同一收集器之 run 不可重疊;明示之收集器物件須即目前脈絡之作用中收集器(複審 G1、G2).
22. 祖先有啟用之收集範圍(含被遮蔽者)即 `insideEnabledCollect()`;產製端據以拒絕,任意層數(G3).
23. 測試框架之略過訊號(建構函數名 `Pending`)於已收集不符時失敗優先(G4).
24. 案例清單逐目錄各自寫入,失敗彙報不中斷其餘;無清單之證據預設拒收,舊證據須明示 `legacy:true`(G7).
25. 清單紀錄以完整證據路徑(依 cwd 解析)對應證據目錄(G8);採用目的地以檔案身分或真實路徑判重(G9).
26. 預設路徑之 `runBaselineCase` 直接回傳案例本體之 Promise(完成時序同 1.0.10;G11),組態錯誤以 rejected Promise 交回.

## 8.3 單一擁有者

| 事項 | 唯一擁有者 |
|---|---|
| 案例範圍與彙整格式 | `createBaselineCollector`(`activeBaselineCollector` 具名匯出供 `assertBaselineMatch` 讀取) |
| 收集紀錄之產生(pass／diff／size／missing) | `assertBaselineMatch`;'error' 由 `runBaselineCase.compareShots` |
| 標準圖寫檔判定 | `writeBaselineIfChanged`(含 `resolveKeepSame` 具名匯出) |
| 實際埠之計算 | `resolveE2ePort` |
| 證據之讀取與分類 | `reviewPendingShots`;採用 `acceptPendingShots`;CLI `tools/reviewPending.mjs` 只組裝兩者 |

## 8.4 對應測試

| 檔 | 前綴 | 涵蓋 |
|---|---|---|
| `test/unit-baselineCollect.test.mjs` | `[C01]`～`[C35]`(C29 三層巢狀、C30 skip 失敗優先、C31 重用與重疊、C32 他脈絡明示、C33 等待期間之紀錄、C34 逐目錄清單與同毫秒清單、C35 非收集之 pendingDir;檔尾守門:專案根 `./testPending` 不得多檔) | 範圍外不收集(C01)、未啟用不收集(C02)、收集與彙整格式與證據與清單(C03)、其他錯誤(C04)、全通過(C05)、opt.collect 四態與範圍外物件(C06)、並行範圍(C07)、互斥閘門(C08、C14)、runBaselineCase 收集(C10)、預設不變(C16)、語意失敗(C11)、整案／部分缺陷(C12、C13)、比對錯誤續比與清單 failed(C15)、遺留非同步工作(C17)、巢狀(C18)、缺陷＋afterCase 失敗(C19)、副作用失敗(C20)、收集模式之餘裕告警(C21)、自訂 match 補 pass(C22)、多目錄清單(C24)、壞 PNG 候選(C25)、pendingDir 傳預設比對(C26)、pathOf 拋錯續比(C27)、排他建立(C28) |
| `test/unit-keepSame.test.mjs` | `[K01]`～`[K18]` | 預設直接寫(K01、K11)、相同保留 mtime 不變(K02、K10)、KEEP_MAXDIFF 0／N(K03)、格式與優先序(K04、K14)、missing／size／transient(K05)、覆蓋與 outDir(K06)、gate 併用(K12)、compareBuf 兩端共用(K13)、容差同步(K15)、changed 由 keepSame 取代(K16)、自訂 match 須明給容差(K17)、未啟用時同步寫檔之時序(K18) |
| `test/unit-portOffset.test.mjs` | `[P01]`～`[P06]` | resolveE2ePort 解析(P01)、預設不變(P02)、各組埠處(P03)、url 三態與協定預設埠(P04)、真子行程實跑 18930＋100(P05)、可列舉形狀同前版(P06) |
| `test/unit-reviewPending.test.mjs` | `[R01]`～`[R14]`(R10b pathOf 相對＋root、R13 跨目錄同名、R14 junction／大小寫／既有目標別名) | 分類與帶出(R01)、裁圖(R02)、採用拒收(R03、R04)、採用只寫明列(R05)、CLI(R06)、since(R07)、同一目的地(R08)、壞 PNG(R09)、他目錄執行與 --root(R10)、裁圖不覆蓋(R11)、清單衝突(R12) |
| `test/unit-WPackageToolsE2e.test.mjs` | — | 入口登錄五個新模組 |

- 單檔自編:`npx mocha --no-parallel test/unit-baselineCollect.test.mjs test/unit-keepSame.test.mjs test/unit-portOffset.test.mjs test/unit-reviewPending.test.mjs --timeout 180000`.
- 變異驗證(本輪 70/70 殺死:原設計 33、外審第一輪修正 23、第二輪修正 13、測試守門 1):腳本形狀見 `sgud/exp/experience.md`;每個變異於 `./tmp/` 全新副本套用、跑上列四檔.
- 完成時序(G11)不在測試套件內(需載入前版模組比較),以差分腳本守:`git archive HEAD` 解出前版,同一輸入數兩版自呼叫至 settle 之微工作數須相同.

## 8.5 盤點指令

- 組埠處:`Grep "\bport\b|url|baseUrl" src`——除 `createServiceManager` 外,只有收完整網址或埠之原語與 JSDoc 範例.
- 標準圖寫檔處:`Grep "writeFileSync|copyFileSync" src`——`writeBaselineIfChanged`(經 `runBaselineCase`)、`acceptPendingShots`(明列標籤);`assertBaselineMatch` 只寫證據、`createBaselineCollector` 只寫案例清單、`reviewPendingShots` 只寫裁圖.
- 環境變數讀取處:`Grep "E2E_COLLECT|E2E_BASELINE_KEEP|E2E_PORT_OFFSET" src`——`assertBaselineMatch` 不得出現 `E2E_COLLECT`(規則 2).

## 8.6 已知限制

- 自訂 `match` 內之覆蓋:收集之 capture 為覆蓋後影像,採用時覆蓋區內容取自舊標準圖;有變更才改寫之判定看不到該覆蓋(多寫).改用 `compareBuf` 即解.
- 審查只看各標籤最新一組;同一標籤於同一趟被比對多次(兩案例共用一張)時只列最新者.
- 案例清單寫在每個有證據之目錄;全為 'error' 紀錄者寫 `pendingDir`(預設 `./testPending`).
- 非收集模式之證據無案例清單,採用須明示 `legacy:true` 並給 `pathOf`(套件無從確認其案例結局;CLI 不提供).
- `since` 含等號比較毫秒時間戳:前後兩趟重疊時同毫秒之舊證據仍列入(複審 G12,文件明載 T 須於前一趟結束後取).
- 證據檔名保留只排他建立 capture:只剩孤立 `__diff.png`／`__baseline.png` 時同標籤同毫秒再失敗會改寫之(1.0.10 既有,為預設不變未改;複審 G10).
- 略過訊號只辨識建構函數名 `Pending`(mocha);其他框架之略過訊號視同一般錯誤(以之為準、清單 failed).
- 自訂 `match` 正常回傳時套件只補記 pass,不知其像素數(numDiff 為 null).
- 不可列舉之 `port` 不會被展開運算子(`{...o}`)複製;轉傳參數物件者須另帶 `port`.
- `[P05]` 使用固定埠 18930／19030;被他行程佔用時該條失敗並註明(不隨機改埠).

## 8.7 變更紀錄

- 2026-10-28(pte2e-run01):新增 `createBaselineCollector`、`writeBaselineIfChanged`、`resolveE2ePort`、`reviewPendingShots`、`acceptPendingShots`、`tools/reviewPending.mjs`;`assertBaselineMatch` 加 `opt.collect`;`runBaselineCase` 加 `collect`／`pendingDir`／`keepSame`／`keepMaxDiff`／`transient`／`compareBuf`／`maxDiffPixels`／`threshold`／`env`;`getE2eMode` 加互斥閘門;`createServiceManager` 加 `env`、`portOf`、spawn／beforeSpawn 之 `port`(皆不可列舉)、url 函數;`assertBaselineMatch` 之證據 capture 改排他建立.同日依 terra 外審 22 條修正(規則 13～20)與複審 14 條修正(規則 21～26;G10、G12 列已知限制).無破壞性變更,不動標準圖像素.
