# 規則帳本: 測試不連 CDN(`createCdnLocal`、`genCdnManifest`、`loadCdnManifest`、`createDirLock`、`tools/genCdnManifest.mjs`)

2026-11-25 te2e632(主控排程第 632 項;需求出處為使用端與全域技能 role-coder-for-test 之「測試不連外部 CDN」要求,本機已同步之技能內尚無該節,依派工摘要實作).API 細節見 `README.md` §1.5、§2.13 與各模組 JSDoc.本輪純新增,不改既有公開函式與其行為.

**設計來源**:他套件之同類實作(原型,唯讀參考;其取得流程、鎖、路由、`fetch` 補丁經該套件 29 案與全套驗證),抽出通用部分並與其他使用端之需求對照(本機伺服器之頁面、無版本釘選之網址、`ws`、先註冊之使用端 `route`).與原型之差異見 §4.

## 1. 規則與測試對照

| 規則 | 內容 | 擁有者 | 測試 |
|---|---|---|---|
| R-CL-1 清單與參數 | 清單 `{ schema: 1, roots?, files: { 網址: { sha256, size } } }` 必給且須合法,**給了而無效一律拋 `E_CDN_MANIFEST`(fail-closed,不回顯 sha256,網址經 `maskDiagText`)**;網址須 http(s)、不含空白與 `#`(可含 `?`)且能被 URL 解析,sha256 為 64 碼十六進位(轉小寫),size 為非負安全整數(0 為空檔),`type`(選填 content-type)為 1 至 200 字之可見 ASCII(去前後空白,供副檔名無法判定類型之網址);載入後不與輸入共用參照;**清單之鍵與請求網址一律先依 WHATWG URL 正規化(去前後空白與 tab、主機小寫、預設埠省略)並去片段再比對,正規化後相同而內容(sha256、size、type)不同者為清單矛盾,拋 `E_CDN_MANIFEST`**.安全相關 opt:`manifest` 未給拋 `E_CDN_ARG`、不合法拋 `E_CDN_MANIFEST`,`cacheDir`、`allow` 給了而無效拋 `E_CDN_ARG`;其餘 opt(時限、並行數、`offline`、`allowLoopback`、`onTrace` 等)非預期之輸入視為未給、改用預設(K3) | `src/loadCdnManifest.mjs`、`src/createCdnLocal.mjs` | `unit-createCdnLocal` `[CL01]`、`[CL02]`、`[CL02b]`、`[CL03]` |
| R-CL-2 取得 | 缺什麼取什麼;經 wsemi `fsDownloadFileVerify`(暫存檔、sha256 與大小校驗、原子更名)存為 `<cacheDir>/<sha256>`;同內容(sha256 相同)之多個網址只取一次;快取內之檔每次就緒前依大小與 sha256 重驗,損毀(同長度內容不同、截斷)只重取該檔;備妥後不取鎖、不連網;每次下載追加一列 `downloads.jsonl`;下載失敗帶 `fsDownloadFileVerify` 之 code(`E_HASH_MISMATCH`、`E_HTTP` 等);持鎖者逾 `budgetMs` 不再派發新檔(`E_CDN_ACQUIRE_TIMEOUT`);**下載後之回驗自磁碟全部重算**(`E_CDN_VERIFY`;原型沿用本實例已校驗之記錄,回驗實質為空);取得於實例內只做一次、失敗亦記住 | `src/createCdnLocal.mjs` | `[CL05]`、`[CL11]`～`[CL16]`、`[CL18]`、`[CL37]` |
| R-CL-3 離線 | `opt.offline`(未給時環境變數 `W_CDN_OFFLINE`＝`1`／`true`,不分大小寫)為真時缺檔不連網、不取鎖,拋 `E_CDN_OFFLINE_MISSING`;`err.missing` 為 `[{ url, sha256, size, cachePath }]`,訊息只含檔名(不含 sha256 與路徑,V20);備妥時離線照常就緒 | 同上 | `[CL19]`;`api-createCdnLocal` `[CA04]`(跨行程) |
| R-CL-4 跨行程只下載一次 | 資料夾鎖 `<cacheDir>/.lock`(`createDirLock`):`mkdir` 原子互斥;`owner.json` 記 pid 與 token;持有者以心跳(`owner.json` 之修改時間,間隔為 `staleMs` 之 1/3,10 毫秒至 2 秒,`unref`)表明存活;**心跳**每次先核對 `owner.json` 之 token 仍是自己(被接手後停止,不刷新他人之鎖;鎖被搬走〔ENOENT〕亦停止),再更新 `owner.json` 與鎖資料夾之修改時間;**殘留判定**＝持有者行程不存在,或心跳逾 `staleMs`(`owner.json` 在而無法解析〔寫到一半、暫時讀不到〕者仍以其修改時間判定、不取其中之 pid 與 token——不退回鎖資料夾之修改時間,免把長時間持有之活鎖誤判為殘留;`owner.json` 不在〔剛建立〕者看鎖資料夾之修改時間;`pid` 非正整數視為無 pid);**回收**＝先 `rename` 搬走(原子,同一把鎖只有一個回收者成功)再核對搬走者之 token＝判定當下之持有者,不符(搬到他人剛建立之新鎖)則改回,改回失敗(已有更新之鎖)才刪;釋放核對 token,不刪他人之鎖;建鎖遇 `EPERM`／`EBUSY`／`EACCES` 而鎖資料夾仍在視為占用,鎖資料夾不在而連續被拒 100 次才拋出(遇鎖資料夾存在即重新計數);同一實例於鎖被移除後再取得時先停止先前之心跳;建了鎖卻寫不出 `owner.json` 不遺留無主之鎖;**取得鎖後先重算缺檔清單**(檢查與寫入在同一把鎖內,他行程可能已補齊);等候者之等候上限 ＞ 殘留判定時長;持鎖後先清除逾 `staleMs` 之 `.part` 與 `.lock.stale-*` | `src/createDirLock.mjs`、`src/createCdnLocal.mjs` | `unit-createDirLock` `[DL01]`～`[DL16]`(含 `[DL04b]`);`unit-createCdnLocal` `[CL06]`～`[CL10]`、`[CL17]`、`[CL36]`;`api-createCdnLocal` `[CA01]`(4 行程)、`[CA02]`(持鎖行程被強制結束)、`[CA03]`(跨行程心跳) |
| R-CL-5 時限對齊 | 預設預算 15 分鐘、單檔 120 秒、殘留判定 150 秒(＞ 單檔上限)、等候上限 17.5 分鐘(＝預算＋單檔上限＋30 秒收尾餘裕〔清殘留、回驗〕,＞ 殘留判定)、`before` 時限 35.5 分鐘(＝等候上限＋預算＋單檔上限＋1 分鐘,≫ mocha 全域 180 秒);僅給 `budgetMs`／`fileTimeoutMs` 時衍生之 `staleMs` ＞ `fileTimeoutMs`、`waitMs` ＞ `staleMs`(小預算時亦然);明確給定之 `staleMs`、`waitMs` 不檢查大小關係(測試用小值);常數具名匯出,實例之 `timeouts`、`hookTimeoutMs` 為實際值 | `src/createCdnLocal.mjs` | `[CL04]`、`[CL12]` |
| R-CL-6 瀏覽器路由 | `routeBrowser(browser\|context\|page)`:掛涵蓋全部網址之路由,browser 者另包裝 `newContext`／`newPage`(先同步包裝,再掛已存在之 context;掛失敗則還原包裝〔原型方法者刪自有屬性〕與標記,可重試);處理順序**清單內(`fulfill`:200、`content-type`〔清單項目之 `type` 優先,否則依副檔名〕、CORS、位元組)→ 放行(`fallback`)→ 清單外(`abort('blockedbyclient')`＋記錄)**;**另對 context 掛 `request` 事件之觀察者**(Chromium 實測事件先於 route;涵蓋重新導向之後續請求與被使用端後註冊之 route 以 `continue()` 放走者——route 攔不到之情形):清單外且非放行者記為違規(只記錄、來不及中止,重新導向者註明),**同一 Request 物件於 route 處理器與觀察者各看到一次,依物件去重只記一筆(不論先後)**;`isRouted(target)`(browser／context／page 之 context 是否經本實例掛過,標記屬於實例,存於 `WeakMap`,不在 Playwright 物件上留屬性);非 http(s)/ws(s) 請求 `fallback`;本地副本不可用(取得失敗、快取檔被刪)者 `abort('failed')` 並記為違規(不放行外網,理由只帶 code 不帶路徑);ws(s) 以 `routeWebSocket`(判定函數為「非放行」)關閉並記錄,放行者不攔截;browser／context 之 `close()` 於真正關閉後,若自上次關閉起有違規拋 `E_CDN_EXTERNAL`(只拋一次,`failOnClose:false` 不包裝);重複呼叫不重複掛;掛失敗不留標記;參數非 browser／context／page 拋 `E_CDN_ARG` | `src/createCdnLocal.mjs` | `[CL28]`～`[CL34]`、`[CL38]`～`[CL42]`;`e2e-createCdnLocal` `[CE01]`～`[CE14]`(真瀏覽器) |
| R-CL-7 放行(外部請求之界線) | 回送位址(`localhost`、`*.localhost`、`127.x.x.x`、`[::1]`;以 `new URL().hostname` 判定,`127.0.0.1.invalid`、`localhost.invalid` 等前綴相似之外部主機不算)預設放行(`allowLoopback`),`allow`(RegExp〔每次比對前重設 `lastIndex`〕或函數;**函數須恰回傳 `true` 才放行**——async 函數之 Promise、`'yes'` 等真值、拋錯皆不放行,async 函數之 rejection 已攔下)明列者放行;**清單內優先於放行**;放行用 `fallback`,故使用端先註冊之 `route` 照常生效 | 同上 | `[CL24]`、`[CL25]`、`[CL29]`、`[CL38]`;`[CE05]`、`[CE06]`、`[CE10]` |
| R-CL-8 Node 端 fetch | `patchFetch()` 覆寫全域 `fetch`:**請求網址先依 `fetch` 自己之解析規則正規化**(`' https://…'`、`'\thttps://…'`、`'ht\ttps://…'`、`{ toString }` 物件、`URL`、`Request` 皆經正規化,不因寫法不同而繞過;無法解析之相對網址與非 http(s) 交原 fetch),http(s) 且在清單內回本地副本(片段不計;`content-type` 同路由),清單外拋 `E_CDN_EXTERNAL` 並記錄,放行者與非 http(s) 走原 fetch;本地副本不可用拋 `E_CDN_UNAVAILABLE`(`cause` 帶原錯誤,記為違規,訊息不含路徑);回傳還原函數:同一實例重複補丁回傳同一個,還原可重複呼叫,被他人包在其上者還原後改為直通(不破壞鏈);**下載用 fetch 於建立實例時取得且剝除本模組之補丁**(補丁內再下載不被自己攔下),不剝除他人之補丁 | 同上、`cdnNativeFetch` | `[CL20]`～`[CL26]`、`[CL23b]`、`[CL35]` |
| R-CL-9 違規判定 | 違規記錄於實例(凍結物件 `{ kind: 'browser'\|'fetch'\|'websocket', url, reason }`,網址經 `maskDiagText`);`violationMark()` 回傳綁實例之標記,`assertNoViolation(mark)` 斷言自標記起無新增違規(未給標記＝自實例建立起;標記非本實例所發拋 `E_CDN_ARG`);`getViolations()` 回傳複本;`stats()` 回傳快照 | 同上 | `[CL21]` |
| R-CL-10 清單之產生 | `genCdnManifest`:下載根網址,求相對匯入之閉包(副檔名符合 `opt.esm`〔預設 `.mjs`〕者解析 `from`／`import`／`import()`;`.css` 者解析 `@import`／`url()`,略過註解與 `data:`,去 `#` 片段、保留 `?` 查詢),每檔只下載一次(含迴圈),重試 `maxAttempts` 次,依網址排序,產出經 `loadCdnManifest` 檢核;**絕對網址與協定相對網址(`//host/x`)之指定詞不自動納入,未列入 roots〔以正規化形式比對〕者拋 `E_CDN_GEN`**(不靜默略過;無法解析為網址之指定詞略過);副檔名無法判定內容類型者(`cdnMimeOf` 回 octet-stream)另記伺服器回應之 content-type(可見 ASCII 者)於 `type` 欄;`diffCdnManifest`:added／removed／changed(sha256 或大小)／roots(不計順序);CLI:`--roots`(`.json` 或 `.mjs`)／`--url`、`--out`、`--check`(不寫檔,不同離開碼 1)、`--note`、`--concurrency`,參數錯誤離開碼 2、下載失敗離開碼 1 且不寫檔 | `src/genCdnManifest.mjs`、`tools/genCdnManifest.mjs` | `unit-genCdnManifest` `[GM01]`～`[GM09]`(含 `[GM04b]`、`[GM04c]`);`api-genCdnManifest` `[GC01]`～`[GC05]` |
| R-CL-11 不改既有 | 本輪純新增:五個模組(`createCdnLocal`、`createDirLock`、`genCdnManifest`、`loadCdnManifest` 與其具名匯出)登錄於共用入口(`unit-WPackageToolsE2e` 守門);既有公開函式與行為不變;新增之 child_process 呼叫皆帶 `windowsHide: true`(`unit-childProcHide` 守門) | 入口 | `unit-WPackageToolsE2e`、`unit-childProcHide` |

## 2. 輸入空間表

### 2.1 請求 × 處置(瀏覽器端與 Node 端 fetch 同一張表,差別只在「中止」之形式)

| 請求 | 在清單內 | 不在清單內 | 測試 |
|---|---|---|---|
| http(s),非回送、未列 `allow` | 本地副本回應 | 中止＋違規(fetch:拋 `E_CDN_EXTERNAL`) | `[CL22]`、`[CL23]`、`[CL28]`、`[CL29]` |
| http(s),回送位址 | 本地副本回應(清單優先) | 放行(`allowLoopback:false` 時視為外部) | `[CL24]`、`[CL25]`、`[CL38]`、`[CE05]`、`[CE06]` |
| http(s),`allow` 明列 | 本地副本回應 | 放行 | `[CL24]`、`[CL29]` |
| 同路徑不同查詢／同庫不同版本 | 視為不同網址 | 中止＋違規 | `[CL23]`、`[CE03]` |
| 片段(`#`) | 不計(`lookup` 去片段) | — | `[CL22]` |
| ws(s) | (清單只含 http(s)) | 非放行者關閉＋違規;放行者不攔截 | `[CL31]`、`[CE07]` |
| `data:`、`blob:`、`file:`、`about:` | — | 不處理 | `[CL29]`、`[CE08]` |
| 清單內但本地副本不可用 | 中止(`failed`)＋違規;fetch 拋 `E_CDN_UNAVAILABLE` | — | `[CL30]`、`[CL35]`、`[CE09]` |
| Dedicated Worker 發出 | 同頁面 | 同頁面 | `[CE11]` |
| 放行之回送位址回 3xx 導向外部(後續請求不經 route) | — | observer 記違規(重新導向),只記錄 | `[CL41]`、`[CE12]` |
| 使用端於 `routeBrowser` 之後註冊之 route 以 `continue()` 放走 | — | observer 記違規,只記錄 | `[CL41]`、`[CE13]` |
| fetch 之網址寫法(前後空白、tab、主機大小寫、預設埠、`{ toString }`、`URL`、`Request`) | 正規化後比對,同一份清單項目 | 正規化後判定為外部 | `[CL23b]`、`[CL02b]` |
| SharedWorker 之請求、Worker 內之 WebSocket、`context.request`、Node 之 `http`／`https`／`undici`／全域 `WebSocket`、先保存之 fetch 參考 | 攔不到(已知限制,README §2.13 限制③⑤) | 攔不到 | — |
| 漏接(未呼叫 `routeBrowser` 之瀏覽器) | — | 不攔不記;`isRouted` 供使用端斷言 | `[CL40]`、`[CE14]` |

### 2.2 取得之起點狀態(`ensure`)

| 起點 | 行為 | 測試 |
|---|---|---|
| 快取已備妥 | 就緒,不取鎖、不連網(事件只有 `ready`) | `[CL05]` |
| 快取全缺,無鎖 | 取鎖、下載、回驗、釋放 | `[CL05]` |
| 快取缺,鎖在他行程(存活、心跳新鮮) | 等候,持有者完成後採用;逾 `waitMs` 拋 `E_CDN_ACQUIRE_TIMEOUT`,不動他人之鎖、不連網 | `[CL08]`、`[CL09]`;`[CA01]`、`[CA03]` |
| 鎖之持有者行程不存在 | 判定殘留、回收、取鎖、下載 | `[CL06]`;`[CA02]`(真實被強制結束) |
| 鎖之心跳逾 `staleMs` | 同上 | `[CL07]` |
| 兩個回收者交錯(先回收者已建立新鎖) | 後到者不刪新鎖、不下載,待其釋放後才取鎖 | `[CL10]`;`[DL06]`(原語) |
| 回收後、取鎖前他行程補齊 | 取鎖後重算,不下載 | `[CL36]` |
| 部分損毀／截斷 | 只重取該檔 | `[CL15]`、`[CL16]` |
| 下載內容 sha256 不符 | 拒收,不落最終位置,釋放鎖,無 `.part` | `[CL13]` |
| 下載逾預算 | 不再派發新檔,`E_CDN_ACQUIRE_TIMEOUT`,釋放鎖,失敗被記住 | `[CL12]` |
| 下載後檔被刪 | 回驗 `E_CDN_VERIFY`,釋放鎖 | `[CL37]` |
| 殘留 `.part`／墓碑 | 持鎖後清除逾 `staleMs` 者,較新者不動 | `[CL17]` |
| 離線 | 缺檔 `E_CDN_OFFLINE_MISSING`;備妥照常 | `[CL19]`、`[CA04]` |

## 3. 變異驗證

於鏡像根(`./tmp/te2e632/mut/`,只複製檔案、不建目錄連結)對 `src/`、`tools/` 單點植入缺陷,以 mocha(`--bail`)跑本輪新增之測試檔,失敗即擊殺;錨點不存在或不唯一者報錯不略過.結果見本輪報告(`C:\opensrcOper\dnow\20261124223109\agent-out\te2e632-修正報告.md`)及其證據夾 `te2e632-evidence\mut-results*.json`.存活者之分類(等價／缺口)與處置見 `sgud/state/state.md` 本輪條.

## 4. 與原型之差異(理由)

| 項 | 原型 | 本庫 | 理由 |
|---|---|---|---|
| 回送位址 | 一律視為外部(違規) | 預設放行,`allowLoopback`／`allow` 可調 | 使用端之頁面多由本機伺服器提供,不放行則頁面本身載不進;原型之使用端頁面皆為 `setContent`／`data:` |
| 清單網址 | 僅 https、不含 `?` | http(s)、可含 `?`、不含 `#` | 字型等資源常帶查詢;內網 CDN 可能為 http(sha256 釘選,內容仍受校驗) |
| 清單 size | ≥ 1 | ≥ 0 | 允許以空檔供應 `nomodule` 之 polyfill 腳本等 |
| 下載後回驗 | 重算缺檔清單,但本實例已校驗者略過(實質為空) | 全部自磁碟重算 | 回驗須能抓到下載後被刪或被改之檔(`[CL37]`) |
| 測試後門 | `opt.onStaleJudged`(await 之測試鉤子) | 無;以 `onTrace` 之 `lock-stale-judged` 事件(同步呼叫)於回調內以檔案操作重現交錯,另有 `createDirLock` 原語層之確定性交錯案 | 觀察回調為對外 API 而非測試專用之後門(計時器規格 P3、P4) |
| 殘留暫存 | 不清 | 持鎖後清除逾 `staleMs` 之 `.part` 與墓碑 | 被強制結束之下載會留下 `.part`,長期累積 |
| 鎖之實作 | 內嵌於 `createCdnStore` | 抽為 `createDirLock`(原語可單測、可獨立使用) | 原語層可確定性重現回收交錯,不依賴延時 |
| 路由目標 | 只接 w-playwright 之 `setBrowserTypeForTest` 回傳之 browser | 接受 Playwright 之 browser／context／page | 不綁定 w-playwright 之內部接縫 |
| ws(s) | 處理器內判斷 `wss?:`(Playwright 之 HTTP 路由實際不會收到) | `routeWebSocket` | 真正攔得到(`[CE07]`) |
| 違規訊息 | 含網址原文 | 網址經 `maskDiagText`;本地副本不可用只帶 code | 診斷輸出與遮罩規格 D3、V20 |
| `fetch` 補丁 | 模組載入時即覆寫全域 `fetch`(`installCdnLocal`) | 由 `patchFetch()` 明確呼叫,回傳還原函數 | 共用庫不得於載入時改全域;多個測試檔同一行程時須可還原 |
| 涵蓋盤點(哪些測試檔啟動瀏覽器卻未接縫) | 使用端自寫之守門測試 | 不提供;改提供 `isRouted(target)` 供使用端於單一啟動出口斷言 | 屬使用端之專案結構;原型以全域包裝 launch 使「漏接」不可能,本庫不綁定 w-playwright 之接縫故不能,README §2.13 限制⑥ |
| 放行之回送位址回 3xx 導向外部 | 路由未涵蓋(未偵測) | `request` 事件觀察者記違規 | 獨立審查實測原型與初版皆放過(`[CE12]`) |
| 請求網址之判定 | 以原字串之 `^https?://` 判定 | 先依 URL 規則正規化 | `' https://x'`、`'ht\ttps://x'` 等寫法會使原判定直通(獨立審查實測) |
| 清單之 content-type | 依副檔名 | 清單項目 `type` 優先(產生器依伺服器回應記下),無則依副檔名 | 無副檔名、僅有查詢之網址(字型樣式表等)以 octet-stream 供應會使 stylesheet 與 ESM 靜默壞掉 |
| 時限 | 等候上限 17 分鐘 | 17.5 分鐘(＋30 秒收尾餘裕) | 與持鎖者同時起算之等候者在最壞情形不應早於持鎖者之收尾(清殘留、回驗)逾時 |
| 環境變數、錯誤型別(使用端遷移須留意) | 離線之環境變數以單一套件為名、錯誤為 `TypeError` | `W_CDN_OFFLINE`、帶 `code` 之 `Error` | 共用化後不以單一套件命名;`E_CDN_*` 碼統一 |

## 5. 已知限制

見 `README.md` §2.13〈限制〉①～⑩(只記錄不中止者、攔不到亦無事件者、Node 端其他出口、漏接、PID 命名空間).另:`createDirLock` 之回收有極小空窗(判定與改名之間;judge 之退回路徑已改為先看 `owner.json` 之修改時間,不再因 `owner.json` 暫時讀不到而把長時間持有之活鎖判為殘留);`.part` 清除以修改時間判定,被暫停逾 `staleMs` 之下載可能被誤清(其下載會失敗並重試);`W_CDN_OFFLINE` 為行程啟動時讀取之環境變數;`E_CDN_ACQUIRE_TIMEOUT` 之等候以 `Date.now()` 計(系統時鐘被調整時不準,與 `pollUntil` 同).

## 6. 改動範圍 → 測試檔

| 改動 | 測試檔 |
|---|---|
| `src/createDirLock.mjs` | `unit-createDirLock`;`unit-createCdnLocal`(經 `createCdnLocal`);`api-createCdnLocal`(真實行程) |
| `src/createCdnLocal.mjs`、`src/loadCdnManifest.mjs` | `unit-createCdnLocal`、`api-createCdnLocal`、`e2e-createCdnLocal`、`unit-genCdnManifest`(整合案) |
| `src/genCdnManifest.mjs`、`tools/genCdnManifest.mjs` | `unit-genCdnManifest`、`api-genCdnManifest` |
| `src/WPackageToolsE2e.mjs`(入口) | `unit-WPackageToolsE2e` |
| 夾具 `test/tools/cdnLocalFixture.mjs`、`cdnAcquireChild.mjs` | 上列五檔 |
