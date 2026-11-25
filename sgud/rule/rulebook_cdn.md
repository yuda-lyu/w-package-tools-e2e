# 規則帳本: 測試不連 CDN(`createCdnLocal`、`genCdnManifest`、`loadCdnManifest`、`createDirLock`、`tools/genCdnManifest.mjs`)

2026-11-25 te2e632(主控排程第 632 項;需求出處為使用端與全域技能 role-coder-for-test 之「測試不連外部 CDN」要求,本機已同步之技能內尚無該節,依派工摘要實作).API 細節見 `README.md` §1.5、§2.13 與各模組 JSDoc.本輪純新增,不改既有公開函式與其行為.

2026-11-25 t636(主控排程第 636 項本庫部分;需求出處為各使用端第 632 項之回饋,Gitea 另案):R-CL-12(清單內網址被使用端 route 放走之偵測,**破壞性**)、R-CL-13(`opt.sources` 本機檔來源、`opt.stubs` 空腳本)、R-CL-14(`routeLaunch`、`useMocha`)、R-CL-15(`opt.loopbackPorts`);旗標組加 `--disable-smooth-scrolling` 見 `rulebook_launch.md` R-LB-7.不做向後相容(使用者原則,下游配合).w-playwright 之可疊放鉤子、安裝預算常數、`launchBrowser` 之 `autoInstall` 預算(第 636 項 ③④⑤)須 w-playwright 先改,不在本輪(介面草案見本輪報告).

2026-11-26 t636e(主控排程第 636 項 ⑤,本庫部分;w-playwright 1.0.6〔t636w〕已提供 `onBrowserCreated`、`INSTALL_BUDGET_MS`、`LAUNCH_HOOK_TIMEOUT_MS`、`installTimeout`):R-CL-16(`createCdnLocal` 之接線文件首選啟動後鉤子、系列不依賴 w-playwright、`before` 時限合用之建議值);`launchBrowser` 轉出常數與測試 `before` 時限見 `rulebook_launch.md` R-LB-8.不改 `createCdnLocal` 系列之行為.

**設計來源**:他套件之同類實作(原型,唯讀參考;其取得流程、鎖、路由、`fetch` 補丁經該套件 29 案與全套驗證),抽出通用部分並與其他使用端之需求對照(本機伺服器之頁面、無版本釘選之網址、`ws`、先註冊之使用端 `route`).與原型之差異見 §4.

## 1. 規則與測試對照

| 規則 | 內容 | 擁有者 | 測試 |
|---|---|---|---|
| R-CL-1 清單與參數 | 清單 `{ schema: 1, roots?, files: { 網址: { sha256, size } } }` 必給且須合法,**給了而無效一律拋 `E_CDN_MANIFEST`(fail-closed,不回顯 sha256,網址經 `maskDiagText`)**;網址須 http(s)、不含空白與 `#`(可含 `?`)且能被 URL 解析,sha256 為 64 碼十六進位(轉小寫),size 為非負安全整數(0 為空檔),`type`(選填 content-type)為 1 至 200 字之可見 ASCII(去前後空白,供副檔名無法判定類型之網址);載入後不與輸入共用參照;**清單之鍵與請求網址一律先依 WHATWG URL 正規化(去前後空白與 tab、主機小寫、預設埠省略)並去片段再比對,正規化後相同而內容(sha256、size、type)不同者為清單矛盾,拋 `E_CDN_MANIFEST`**.安全相關 opt:`manifest` 未給拋 `E_CDN_ARG`、不合法拋 `E_CDN_MANIFEST`,`cacheDir`、`allow` 給了而無效拋 `E_CDN_ARG`;其餘 opt(時限、並行數、`offline`、`allowLoopback`、`onTrace` 等)非預期之輸入視為未給、改用預設(K3) | `src/loadCdnManifest.mjs`、`src/createCdnLocal.mjs` | `unit-createCdnLocal` `[CL01]`、`[CL02]`、`[CL02b]`、`[CL03]` |
| R-CL-2 取得 | 缺什麼取什麼;經 wsemi `fsDownloadFileVerify`(暫存檔、sha256 與大小校驗、原子更名)存為 `<cacheDir>/<sha256>`;同內容(sha256 相同)之多個網址只取一次;快取內之檔每次就緒前依大小與 sha256 重驗,損毀(同長度內容不同、截斷)只重取該檔;備妥後不取鎖、不連網;每次下載追加一列 `downloads.jsonl`;下載失敗帶 `fsDownloadFileVerify` 之 code(`E_HASH_MISMATCH`、`E_HTTP` 等);持鎖者逾 `budgetMs` 不再派發新檔(`E_CDN_ACQUIRE_TIMEOUT`);**下載後之回驗自磁碟全部重算**(`E_CDN_VERIFY`;原型沿用本實例已校驗之記錄,回驗實質為空);取得於實例內只做一次、失敗亦記住 | `src/createCdnLocal.mjs` | `[CL05]`、`[CL11]`～`[CL16]`、`[CL18]`、`[CL37]` |
| R-CL-3 離線 | `opt.offline`(未給時環境變數 `W_CDN_OFFLINE`＝`1`／`true`,不分大小寫)為真時缺檔不連網、不取鎖,拋 `E_CDN_OFFLINE_MISSING`;`err.missing` 為 `[{ url, sha256, size, cachePath }]`,訊息只含檔名(不含 sha256 與路徑,V20);備妥時離線照常就緒 | 同上 | `[CL19]`;`api-createCdnLocal` `[CA04]`(跨行程) |
| R-CL-4 跨行程只下載一次 | 資料夾鎖 `<cacheDir>/.lock`(`createDirLock`):`mkdir` 原子互斥;`owner.json` 記 pid 與 token;持有者以心跳(`owner.json` 之修改時間,間隔為 `staleMs` 之 1/3,10 毫秒至 2 秒,`unref`)表明存活;**心跳**每次先核對 `owner.json` 之 token 仍是自己(被接手後停止,不刷新他人之鎖;鎖被搬走〔ENOENT〕亦停止),再更新 `owner.json` 與鎖資料夾之修改時間;**殘留判定**＝持有者行程不存在,或心跳逾 `staleMs`(`owner.json` 在而無法解析〔寫到一半、暫時讀不到〕者仍以其修改時間判定、不取其中之 pid 與 token——不退回鎖資料夾之修改時間,免把長時間持有之活鎖誤判為殘留;`owner.json` 不在〔剛建立〕者看鎖資料夾之修改時間;`pid` 非正整數視為無 pid);**回收**＝先 `rename` 搬走(原子,同一把鎖只有一個回收者成功)再核對搬走者之 token＝判定當下之持有者,不符(搬到他人剛建立之新鎖)則改回,改回失敗(已有更新之鎖)才刪;釋放核對 token,不刪他人之鎖;建鎖遇 `EPERM`／`EBUSY`／`EACCES` 而鎖資料夾仍在視為占用,鎖資料夾不在而連續被拒 100 次才拋出(遇鎖資料夾存在即重新計數);同一實例於鎖被移除後再取得時先停止先前之心跳;建了鎖卻寫不出 `owner.json` 不遺留無主之鎖;**取得鎖後先重算缺檔清單**(檢查與寫入在同一把鎖內,他行程可能已補齊);等候者之等候上限 ＞ 殘留判定時長;持鎖後先清除逾 `staleMs` 之 `.part` 與 `.lock.stale-*` | `src/createDirLock.mjs`、`src/createCdnLocal.mjs` | `unit-createDirLock` `[DL01]`～`[DL16]`(含 `[DL04b]`);`unit-createCdnLocal` `[CL06]`～`[CL10]`、`[CL17]`、`[CL36]`;`api-createCdnLocal` `[CA01]`(4 行程)、`[CA02]`(持鎖行程被強制結束)、`[CA03]`(跨行程心跳) |
| R-CL-5 時限對齊 | 預設預算 15 分鐘、單檔 120 秒、殘留判定 150 秒(＞ 單檔上限)、等候上限 17.5 分鐘(＝預算＋單檔上限＋30 秒收尾餘裕〔清殘留、回驗〕,＞ 殘留判定)、`before` 時限 35.5 分鐘(＝等候上限＋預算＋單檔上限＋1 分鐘,≫ mocha 全域 180 秒);僅給 `budgetMs`／`fileTimeoutMs` 時衍生之 `staleMs` ＞ `fileTimeoutMs`、`waitMs` ＞ `staleMs`(小預算時亦然);明確給定之 `staleMs`、`waitMs` 不檢查大小關係(測試用小值);常數具名匯出,實例之 `timeouts`、`hookTimeoutMs` 為實際值 | `src/createCdnLocal.mjs` | `[CL04]`、`[CL12]` |
| R-CL-6 瀏覽器路由(清單內網址被放走之偵測見 R-CL-12;啟動出口接線見 R-CL-14) | `routeBrowser(browser\|context\|page)`:掛涵蓋全部網址之路由,browser 者另包裝 `newContext`／`newPage`(先同步包裝,再掛已存在之 context;掛失敗則還原包裝〔原型方法者刪自有屬性〕與標記,可重試);處理順序**清單內(`fulfill`:200、`content-type`〔清單項目之 `type` 優先,否則依副檔名〕、CORS、位元組)→ 放行(`fallback`)→ 清單外(`abort('blockedbyclient')`＋記錄)**;**另對 context 掛 `request` 事件之觀察者**(Chromium 實測事件先於 route;涵蓋重新導向之後續請求與被使用端後註冊之 route 以 `continue()` 放走者——route 攔不到之情形):清單外且非放行者記為違規(只記錄、來不及中止,重新導向者註明),**同一 Request 物件於 route 處理器與觀察者各看到一次,依物件去重只記一筆(不論先後)**;`isRouted(target)`(browser／context／page 之 context 是否經本實例掛過,標記屬於實例,存於 `WeakMap`,不在 Playwright 物件上留屬性);非 http(s)/ws(s) 請求 `fallback`;本地副本不可用(取得失敗、快取檔被刪)者 `abort('failed')` 並記為違規(不放行外網,理由只帶 code 不帶路徑);ws(s) 以 `routeWebSocket`(判定函數為「非放行」)關閉並記錄,放行者不攔截;browser／context 之 `close()` 於真正關閉後,若自上次關閉起有違規拋 `E_CDN_EXTERNAL`(只拋一次,`failOnClose:false` 不包裝);重複呼叫不重複掛;掛失敗不留標記;參數非 browser／context／page 拋 `E_CDN_ARG` | `src/createCdnLocal.mjs` | `[CL28]`～`[CL34]`、`[CL38]`～`[CL42]`;`e2e-createCdnLocal` `[CE01]`～`[CE14]`(真瀏覽器) |
| R-CL-7 放行(外部請求之界線) | 回送位址(`localhost`、`*.localhost`、`127.x.x.x`、`[::1]`;以 `new URL().hostname` 判定,`127.0.0.1.invalid`、`localhost.invalid` 等前綴相似之外部主機不算)預設放行(`allowLoopback`),`allow`(RegExp〔每次比對前重設 `lastIndex`〕或函數;**函數須恰回傳 `true` 才放行**——async 函數之 Promise、`'yes'` 等真值、拋錯皆不放行,async 函數之 rejection 已攔下)明列者放行;**清單內優先於放行**;放行用 `fallback`,故使用端先註冊之 `route` 照常生效 | 同上 | `[CL24]`、`[CL25]`、`[CL29]`、`[CL38]`;`[CE05]`、`[CE06]`、`[CE10]` |
| R-CL-8 Node 端 fetch | `patchFetch()` 覆寫全域 `fetch`:**請求網址先依 `fetch` 自己之解析規則正規化**(`' https://…'`、`'\thttps://…'`、`'ht\ttps://…'`、`{ toString }` 物件、`URL`、`Request` 皆經正規化,不因寫法不同而繞過;無法解析之相對網址與非 http(s) 交原 fetch),http(s) 且在清單內回本地副本(片段不計;`content-type` 同路由),清單外拋 `E_CDN_EXTERNAL` 並記錄,放行者與非 http(s) 走原 fetch;本地副本不可用拋 `E_CDN_UNAVAILABLE`(`cause` 帶原錯誤,記為違規,訊息不含路徑);回傳還原函數:同一實例重複補丁回傳同一個,還原可重複呼叫,被他人包在其上者還原後改為直通(不破壞鏈);**下載用 fetch 於建立實例時取得且剝除本模組之補丁**(補丁內再下載不被自己攔下),不剝除他人之補丁 | 同上、`cdnNativeFetch` | `[CL20]`～`[CL26]`、`[CL23b]`、`[CL35]` |
| R-CL-9 違規判定 | 違規記錄於實例(凍結物件 `{ kind: 'browser'\|'fetch'\|'websocket', url, reason }`,網址經 `maskDiagText`);`violationMark()` 回傳綁實例之標記,`assertNoViolation(mark)` 斷言自標記起無新增違規(未給標記＝自實例建立起;標記非本實例所發拋 `E_CDN_ARG`);`getViolations()` 回傳複本;`stats()` 回傳快照 | 同上 | `[CL21]` |
| R-CL-10 清單之產生 | `genCdnManifest`:下載根網址,求相對匯入之閉包(副檔名符合 `opt.esm`〔預設 `.mjs`〕者解析 `from`／`import`／`import()`;`.css` 者解析 `@import`／`url()`,略過註解與 `data:`,去 `#` 片段、保留 `?` 查詢),每檔只下載一次(含迴圈),重試 `maxAttempts` 次,依網址排序,產出經 `loadCdnManifest` 檢核;**絕對網址與協定相對網址(`//host/x`)之指定詞不自動納入,未列入 roots〔以正規化形式比對〕者拋 `E_CDN_GEN`**(不靜默略過;無法解析為網址之指定詞略過);副檔名無法判定內容類型者(`cdnMimeOf` 回 octet-stream)另記伺服器回應之 content-type(可見 ASCII 者)於 `type` 欄;`diffCdnManifest`:added／removed／changed(sha256 或大小)／roots(不計順序);CLI:`--roots`(`.json` 或 `.mjs`)／`--url`、`--out`、`--check`(不寫檔,不同離開碼 1)、`--note`、`--concurrency`,參數錯誤離開碼 2、下載失敗離開碼 1 且不寫檔 | `src/genCdnManifest.mjs`、`tools/genCdnManifest.mjs` | `unit-genCdnManifest` `[GM01]`～`[GM09]`(含 `[GM04b]`、`[GM04c]`);`api-genCdnManifest` `[GC01]`～`[GC05]` |
| R-CL-11 不改既有 | 本輪純新增:五個模組(`createCdnLocal`、`createDirLock`、`genCdnManifest`、`loadCdnManifest` 與其具名匯出)登錄於共用入口(`unit-WPackageToolsE2e` 守門);既有公開函式與行為不變;新增之 child_process 呼叫皆帶 `windowsHide: true`(`unit-childProcHide` 守門) | 入口 | `unit-WPackageToolsE2e`、`unit-childProcHide` |
| R-CL-12 清單內網址被放走之偵測(排程第 636 項 ①,2026-11-25;**破壞性**:原通過之使用端可能轉紅,主控已定允許) | **成因**:`request` 觀察者(R-CL-6)對清單內之網址一律 `return`(其供應者預期為本處理器),使用端於 `routeBrowser` 之後註冊之 route(後註冊者先執行)對清單內之網址 `continue()` 時,請求直達真實來源,既不經本處理器、觀察者亦不記——連網時頁面照常載入、測試照過,斷網才紅.**規則**:另對 context 掛 `requestfinished` 之觀察者:請求完成時,網址為 http(s)、在清單內(`lookup`)、且該 Request 物件不在「已由本處理器 fulfill」之集合(`WeakSet`;本處理器於 `route.fulfill` **之前**標記,因 `requestfinished` 可能先於 `fulfill` 之 Promise 解決)者,記違規(理由「清單內之網址未由本地副本供應(請求被使用端自設之 route 以 continue() 等放走，直達來源)」,走 `violateReq` 與 `request` 觀察者共用之 Request 去重).涵蓋:context 層與 page 層 route 之 `continue()`、自行 `fulfill`、`fetch()` 後轉供、重新導向至清單內網址之後續請求(不經 route).不涵蓋:直達來源而連線失敗(發 `requestfailed`,分不出使用端自己 `abort`;斷網時頁面載入失敗,測試本身即紅);**故障模擬**——對清單內之腳本 `abort()`、`fulfill` HTTP 錯誤狀態(404、503 含標頭)時 Chromium 對 `<script>` 發 `requestfailed`,不記(`[CE15g]`;對 `fetch()`／XHR 之錯誤狀態 `fulfill` 為完成,會記,`[CE15i]` 釘住);`fulfill` 200 自有內容(`[CE15e]`)與 `route.fetch()` 後轉供(`[CE15h]`)會記;**時序**——違規於請求完成時才記(`request` 型於發出時即記),`evaluate` 中未等待之 `fetch()`、圖片等之完成可能晚於 `assertNoViolation`(README §2.13 限制②之二);page 層 route 恆先於 context 層,對清單內網址只能 `fallback()`;非清單內者仍只由 `request` 觀察者記(`requestfinished` 不重複記).`attachContext` 掛兩個監聽,掛失敗時兩者皆移除 | `src/createCdnLocal.mjs`(`servedReq`、`makeFinishedObserver`、`attachContext`) | `unit-createCdnLocal` `[CL43]`、`[CL43b]`(含 fulfill 之 Promise 尚未解決時事件已到、同一請求只記一筆、清單外與放行與非網路不重複記、清單列了回送位址者)、`[CL34]`、`[CL41]`(監聽器兩個);`e2e-createCdnLocal` `[CE15a]`～`[CE15f]`(真 Chromium:真實來源為回送位址伺服器,以 `--host-resolver-rules` 將 `real.fixture.invalid` 對應到 `127.0.0.1`;清單釘選 `LOCAL`、真實來源供應 `REAL`,頁面讀到何者即證明請求去向) |
| R-CL-13 本機檔來源與空腳本(排程第 636 項 ⑥,2026-11-25) | **`opt.sources` `{ 網址: 本機檔路徑 }`**:網址須在清單內(正規化後比對)、不得與 `opt.stubs` 並列、正規化後不得重複、路徑為不含 NUL 之非空字串(相對 `process.cwd()` 解析),任一不符拋 `E_CDN_ARG`(fail-closed,訊息帶項目序號、不回顯路徑).**本機檔亦校驗**:`ensure` 於持鎖內對缺或損毀之內容,自本機檔「讀一次、邊讀邊算 sha256 與大小並寫入暫存檔 `<快取檔>.<pid>.<亂數>.part`」,與清單相符才更名入快取(檢查之值即使用之值,不先驗後複製),不符即拋 `E_CDN_SOURCE`(`reason`:`missing`〔stat 為 ENOENT／ENOTDIR〕、`not-file`、`unreadable`〔stat 其他錯誤或串流讀端先失敗〕、`size-mismatch`、`sha256-mismatch`、`cache-write`〔寫端先失敗,或建暫存檔、更名入快取等原生 fs 錯誤,原錯誤置於 `cause`〕;讀端與寫端以「最先發出 error 者」判定,因 pipeline 會把原錯誤再傳給另一端;訊息只帶網址與原因,不含本機路徑與 sha256)並清暫存檔、釋放鎖、失敗被記住,**不改走下載**;快取已備妥者不讀本機檔;快取損毀時自本機檔重補;同內容(sha256)之多個網址只要一個有來源即不下載、只補入一次(`sourced` 以內容計);**同內容有多個本機來源時,全部逐一校驗(其餘來源先只驗不寫,再讀第一個來源寫入),任一不符即拒收且不補入任何內容——不因清單順序或宣告順序而擇一(原則 2 結果與順序無關、原則 3 衝突收嚴)**.離線:有本機來源者照常補齊(不連網、不需網路),仍須連網者拋 `E_CDN_OFFLINE_MISSING`(`err.missing` 只列須連網者).`stats()` 增 `sourced`、`stubs`;事件 `sourced`(`kind`:`file`／`empty`).**`opt.stubs`** 元素為 http(s) 網址字串或 `{ url, type }`(沿用清單之網址與 `type` 檢核),併入有效清單為 `{ sha256: <空內容之 sha256>, size: 0 }`:網址已在清單內者須同為空檔且 `type` 不矛盾,否則拋 `E_CDN_ARG`;供未釘版、測試不需其內容之外部腳本(現況須預置快取檔並手補清單,與產生器之清單矛盾) | `src/createCdnLocal.mjs`(`sources`、`stubUrls`、`localOf`、`materialize`、`sourceErr`、`run`) | `unit-createCdnSources` `[CS01]`～`[CS09]`(含 `[CS04b]`、`[CS04c]` cache-write、`[CS06b]` 同內容多來源全部校驗;`unreadable`〔來源檔讀取失敗、stat 非 ENOENT〕無法確定性重現〔需權限或占用環境〕,變異 M45、M46 存活,列未證);`api-createCdnLocal` `[CA06]`(4 行程同時首次取得,全體只補入 1 次);`e2e-createCdnLocal` `[CE17]` |
| R-CL-14 啟動出口接線(排程第 636 項 ③') | **`routeLaunch(next, ...args)`**:非函數拋 `E_CDN_ARG`;`await next(...args)` 後 `routeBrowser` 並以 `isRouted` 斷言(未掛拋 `E_CDN_ROUTE`);失敗時發 `route-launch-failed`(`code`)、把原因(經 `maskDiagText`)印到 stderr(因 w-playwright 之替身內拋錯會被改寫為固定訊息而隱藏原因)、關閉已啟動之瀏覽器(無 `close` 或 `close` 拋錯皆不蓋掉原錯誤),再拋**原錯誤**;`next` 本身拋錯原樣傳出、不掛路由.接受 browser 或 context(`launchPersistentContext` 之替身亦可).**`useMocha({ hooks, ensure, guard, install })`**:`ensure`(預設 true)→ `before`(`this.timeout(hookTimeoutMs)`＋`ensure()`);`guard`(預設 true)→ `beforeEach`(取 `violationMark()`)、`afterEach`(`assertNoViolation(mark)`,標記每案重取);`install(routeLaunch)` 於取得之後呼叫,其回傳(或 Promise 之)函數於 `after` 還原一次;`ensure`／`guard` 非布林視為未給;`hooks` 預設 `globalThis`,缺所需掛鉤拋 `E_CDN_ARG`(指明缺哪個).**mocha 行為**:`afterEach` 掛鉤失敗時該 describe 之其餘案例不再執行(mocha 規則),故違規只使該 describe 結束,不連累他 describe(`[CA05]`) | `src/createCdnLocal.mjs`(`routeLaunch`、`useMocha`) | `unit-createCdnLocal` `[CL44]`～`[CL47]`(替身);`api-createCdnLocal` `[CA05]`(真 mocha 子行程);`e2e-createCdnLocal` `[CE16]`(真瀏覽器)、`[CE16b]`(README 橋接檔範本經真 w-playwright 之 `setBrowserTypeForTest` 接縫;並釘住「替換而非疊放」) |
| R-CL-15 只放行指定回送埠(排程第 636 項 ⑥,2026-11-25) | **`opt.loopbackPorts`**:1～65535 之安全整數陣列,給了而無效拋 `E_CDN_ARG`(擴大信任範圍,fail-closed).**優先序**(使用者原則 3「衝突收嚴＋提示」):給了者以它為準——回送位址之請求只有埠在其內才放行(`isAllowed`;http／ws 未寫埠為 80、https／wss 為 443),其餘回送位址視為外部;`[]` 不放行任何回送位址;`opt.allow` 明列者仍另放行(聯集);清單內者仍優先由本地副本回應;**明確給 `allowLoopback:false` 又給非空 `loopbackPorts` 為矛盾,拋 `E_CDN_ARG`**(不靜默擇一;`false` 加 `[]` 一致,不拋);`allowLoopback:true` 與 `loopbackPorts` 不矛盾(仍只放行列入之埠);非布林之 `allowLoopback` 視為未給(K3).未給 `loopbackPorts` 者行為不變(`allowLoopback` 全有或全無).路由處理器、Node 端 `fetch`、`routeWebSocket` 之判定函數同一個 `isAllowed` | `src/createCdnLocal.mjs`(`loopbackPorts`、`isAllowed`) | `unit-createCdnSources` `[CS10]`～`[CS13]`;`e2e-createCdnLocal` `[CE18]`(真瀏覽器:同為回送位址而埠不同之站台 `fetch`、`ws` 皆中止並記違規,列入 ws 之埠後放行) |
| R-CL-16 接線文件首選啟動後鉤子;系列不依賴 w-playwright;`before` 時限合用(排程第 636 項 ⑤,2026-11-26;w-playwright 1.0.6〔t636w〕) | **文件(README §2.13、`createCdnLocal` JSDoc)**:啟動出口之接線首選 `wpw.onBrowserCreated((t) => cdn.routeBrowser(t))`(一行;鉤子套在最終回傳給呼叫端之 `Browser` 或持久 `BrowserContext`——`routeBrowser` 皆接受;與 `setBrowserTypeForTest`〔替換、非疊放〕正交,**使用端自設之替身直呼 `next()` 亦生效**,不必於各替身內包 `routeLaunch`;回傳還原函數於 `after` 呼叫;鉤子失敗時 w-playwright 先關閉瀏覽器再 reject `E_LAUNCH_HOOK`;**鉤子套在替身之回傳值上,替身回傳非 Playwright 物件〔測試用假瀏覽器〕時 `routeBrowser` 拋 `E_CDN_ARG`、啟動 reject `E_LAUNCH_HOOK`**,故載入時即全域掛鉤子者,以假物件替身驗接線之測試須先還原鉤子).`routeLaunch(next)`／`useMocha({ install })` 保留為不依 w-playwright 之選項.**`createCdnLocal` 系列(`createCdnLocal`、`createDirLock`、`loadCdnManifest`、`genCdnManifest`、`tools/genCdnManifest.mjs`)不得依賴 w-playwright**(只依 wsemi;第 648 項或將拆出為獨立套件,不得使其帶入 w-playwright)——只改文件與範例,不新增 import.**`before` 時限**:只含 `cdn.ensure()` 者掛 `cdn.hookTimeoutMs`(＝`CDN_HOOK_TIMEOUT_MS`,35.5 分);同一 `before` 先 `await cdn.ensure()` 再啟動瀏覽器(串行)者兩段最壞時間相加,掛 `cdn.hookTimeoutMs + LAUNCH_HOOK_TIMEOUT_MS`(約 54.7 分;**不是取較大者**——較大者只涵蓋一段為最壞),`Promise.all` 並行者取較大者,分在兩個 `before` 者各掛各自之時限;`LAUNCH_HOOK_TIMEOUT_MS` 取自 w-playwright(`launchBrowser.mjs` 具名轉出,`rulebook_launch.md` R-LB-8),`createCdnLocal` 不內建(不依賴 w-playwright).**不改任何行為**:`src/createCdnLocal.mjs` 只改註解 | `src/createCdnLocal.mjs`(JSDoc)、`README.md` §2.13、〈Installation〉第 7 點 | `e2e-createCdnLocal` `[CE16c]`(真 w-playwright:無替身、自設替身直呼 `next()`、持久入口之 `BrowserContext`、還原後不再掛;`[CE16b]` 仍釘住 `routeLaunch` 範本與「替換而非疊放」);`unit-launchBudget` `[LH04]`(系列不 import w-playwright;盤點器有鑑別力) |

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
| 使用端於 `routeBrowser` 之後註冊之 route 以 `continue()` 放走(清單外之網址) | — | `request` 觀察者記違規,只記錄 | `[CL41]`、`[CE13]` |
| 使用端之 route 對**清單內**之網址 `continue()`／自行 `fulfill`／`fetch()` 後轉供(context 層、page 層)(R-CL-12) | 請求完成時記違規「未由本地副本供應」(`requestfinished` 觀察者),只記錄 | — | `[CL43]`、`[CL43b]`、`[CE15a]`、`[CE15d]`、`[CE15e]` |
| 使用端之 route 於 `routeBrowser` 之後註冊但 `fallback()`;或於 `routeBrowser` 之前註冊(其 `continue()` 不會被執行) | 本處理器 `fulfill`,無違規 | — | `[CE15b]`、`[CE15c]`、`[CE10]` |
| 清單內之網址，無使用端 route(對照) | 本地副本供應,不連真實來源,無違規 | — | `[CE15f]` |
| 回送位址,給了 `loopbackPorts`(R-CL-15) | 埠在其內放行、不在其內視為外部(中止並記違規),清單內者仍由本地副本回應 | 同左 | `[CS11]`、`[CS12]`、`[CE18]` |
| `opt.sources` 之網址(R-CL-13) | 本機檔經清單校驗後入快取再供應;不符 `E_CDN_SOURCE` | — | `[CS02]`～`[CS07]`、`[CA06]`、`[CE17]` |
| `opt.stubs` 之網址(R-CL-13) | 空內容供應(併入有效清單) | — | `[CS09]`、`[CE17]` |
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

於鏡像根(`./tmp/te2e632/mut/`,只複製檔案、不建目錄連結)對 `src/`、`tools/` 單點植入缺陷,以 mocha(`--bail`)跑本輪新增之測試檔,失敗即擊殺;錨點不存在或不唯一者報錯不略過.結果見本輪報告(`主控任務資料夾 agent-out/te2e632-修正報告.md`)及其證據夾 `te2e632-evidence\mut-results*.json`.存活者之分類(等價／缺口)與處置見 `sgud/state/state.md` 本輪條.

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

見 `README.md` §2.13〈限制〉①～⑪(只記錄不中止者、攔不到亦無事件者、Node 端其他出口、漏接、PID 命名空間).2026-11-25(第 636 項)新增限制:①直達來源而連線失敗者(`requestfailed`)不記(分不出使用端自己 `abort`);②`opt.sources` 之本機檔只在快取缺或損毀時才讀(快取已備妥者本機檔其後被改不被偵測);③`routeLaunch` 只管經它啟動者;④`afterEach` 掛鉤失敗時 mocha 不再執行該 describe 之其餘案例.另:`createDirLock` 之回收有極小空窗(判定與改名之間;judge 之退回路徑已改為先看 `owner.json` 之修改時間,不再因 `owner.json` 暫時讀不到而把長時間持有之活鎖判為殘留);`.part` 清除以修改時間判定,被暫停逾 `staleMs` 之下載可能被誤清(其下載會失敗並重試);`W_CDN_OFFLINE` 為行程啟動時讀取之環境變數;`E_CDN_ACQUIRE_TIMEOUT` 之等候以 `Date.now()` 計(系統時鐘被調整時不準,與 `pollUntil` 同).

## 6. 改動範圍 → 測試檔

| 改動 | 測試檔 |
|---|---|
| `src/createDirLock.mjs` | `unit-createDirLock`;`unit-createCdnLocal`(經 `createCdnLocal`);`api-createCdnLocal`(真實行程) |
| `src/createCdnLocal.mjs`、`src/loadCdnManifest.mjs` | `unit-createCdnLocal`、`api-createCdnLocal`、`e2e-createCdnLocal`、`unit-genCdnManifest`(整合案) |
| `src/genCdnManifest.mjs`、`tools/genCdnManifest.mjs` | `unit-genCdnManifest`、`api-genCdnManifest` |
| `src/WPackageToolsE2e.mjs`(入口) | `unit-WPackageToolsE2e` |
| 夾具 `test/tools/cdnLocalFixture.mjs`(含 Playwright 替身 `mkCtx`／`mkBrowser`／`mkReq`／`mkRoute`,2026-11-25 自 `unit-createCdnLocal` 移入)、`cdnAcquireChild.mjs` | 上列五檔＋`unit-createCdnSources` |
| `src/createCdnLocal.mjs` 之 `opt.sources`／`opt.stubs`／`opt.loopbackPorts`(2026-11-25) | `unit-createCdnSources`(新增)、`api-createCdnLocal`、`e2e-createCdnLocal` |
| `src/chromiumLaunchArgs.mjs`(R-LB-7,`rulebook_launch.md`) | `api-launchBrowserWiring`、`e2e-browserPrimitives`、`e2e-launchBrowserScroll`、全部 e2e 檔(皆經 `launchBrowser`) |
| `src/createCdnLocal.mjs` 之 JSDoc、README §2.13 之接線文件(R-CL-16,2026-11-26) | `e2e-createCdnLocal` `[CE16c]`、`unit-launchBudget` `[LH04]` |
