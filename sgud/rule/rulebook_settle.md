# 規則帳本: settle 掛鉤之元件辨識(`waitDrawerReady`)

本檔為規則帳本分檔(索引見 `rulebook.md`),記 `src/waitDrawerReady.mjs` 如何從頁面中認出 WDrawer,以及對應測試.編列依據: Gitea #35(cgsmdb 提出:`waitDrawerReady` 之裸 `[state]` 會比對到 w-component-vue 2.5.35 新增 `state` 屬性之元件;2026-11-01 修正,報告 `C:\opensrcOper\dnow\20261031234910\agent-out\pte35-修正報告.md`).

## 1. 帶 `state` 屬性之元件全表(w-component-vue 2.5.35)

來源: 唯讀載入該版 `dist/w-component-vue.umd.js` 於真 Chromium 掛載後逐一傾印根節點屬性(2026-11-01;重跑: `node test/tools/probeWDrawerDom.mjs <w-component-vue 專案根目錄>`),檔:行取自 w-component-vue 原始碼.

| 元件 | 模板(`:state`)／值域宣告 | 值域 | 實際渲染之根節點屬性 | 與 WDrawer 值域重疊(`hidden`/`opening`/`opened`/`hiding`) |
|---|---|---|---|---|
| WDrawer | `WDrawer.vue:3`／`:254` | hidden, opening, opened, hiding | `state`、`changevalue`、`changedrawerwidth`、`changeafloat`(無固定 class;使用端可加 class／id) | — |
| WDialog | `WDialog.vue:5`／`:492` | hidden, opening, opened, resizing | `changeparam`、`state` | 是(hidden／opening／opened) |
| WTooltip 之浮層(`Teleport` 至 body 之 `.WPopperFix`;WPopup 內含 WTooltip,WTextSelect 之下拉亦同,見 w-component-vue `test/e2e-transitionState.test.mjs:7`) | `WTooltip.vue:28`／`:233`;`js/buildPopper.mjs:35`(檢核)、`:62-71`(寫入) | hidden, opening, opened(關閉無 hiding) | `state`、`class="WPopperFix"`、`style`(根節點屬性無 `change*`) | 是 |
| WListExpandItem | `WListExpandItem.vue:3`／`:225` | collapsed, expanding, expanded, collapsing | `state`、`changeactive` | 否 |
| WGroupTags | `WGroupTags.vue:3`／`:649` | idle, moving | `state`、`changevalue` | 否 |
| WGroupDragdrop | `WGroupDragdrop.vue:3`／`:85` | idle, moving | `state`、`changevalue` | 否 |

`WSlider.vue:75` 亦有 `class="WPopperFix"` 但無 `state`(grep 確認,不在表內).

## 2. 規則

- **R1 只認 WDrawer 根節點**: 預設選擇器 `[state][changedrawerwidth]`.依據: 上表只有 WDrawer 之根節點帶 `changedrawerwidth`(`WDrawer.vue:5` 之 `:changeDrawerWidth`,`git log -S` 為 2022-04-28 起;`changeafloat` 為 2023-09-07 起,`state` 為 2026-06-18 起).WDrawer 根節點無固定 class,故無類別名可用.
- **R2 頁面無 WDrawer 立即放行**;**逾時(預設 10000ms)不拋錯**;簽名不變(新增 `opt.selector`).
- **R3 值域篩選維持**: 命中元素之 `state` 須為 `hidden|opening|opened|hiding` 才計入;全部為 `opened`/`hidden` 才放行(多個抽屜全部落定).
- **R4 `opt.selector` 取代預設而非疊加**: 理由—①預設選擇器依元件內部屬性,失效時靜默放行,使用端須能立即改傳而不等套件升版;②使用端可能有非 w-component-vue 之自家元件以 `state` 表示過場(傳 `'[state]'` 即還原舊行為);③提出方(cgsmdb)建議二選一之一即呼叫端傳入選擇器.
- **R4b `opt` 之非預期輸入一律視為未給、改用預設,不拋錯**(dspec〈輸入參數之檢測機制〉K3、V4、V5、V11;pte35b 2026-11-01 由「拋錯」改):①`selector` 非字串、空白字串、無法被瀏覽器解析 → 預設選擇器(解析以頁內 `document.querySelector` 試一次,頁面不可用時視為可解析);②`timeout` 須為大於 0 且不超過 2147483647 之有效數字(wsemi `isenum(v, { gt: 0, max: 2147483647 })`,數字或數字字串,轉換後才使用〔K4〕),否則 10000——0 不收(Playwright 的 0 是永不逾時,會永遠等);③`opt` 為 `undefined`、`null` 或非一般物件(陣列、類別實例、Date、數字、字串、函數)→ 整份視為 `{}`(此時讀不到 `debug`,不警告);④各鍵 `undefined`／`null` 視為未給;每鍵只讀一次,存取器拋錯視為該鍵無效;未宣告之鍵忽略;不改寫呼叫端之 opt.
- **R4c `opt.debug`**(布林,非布林視為 false):為 true 時另輸出警告——固定詞彙、只含函數名／鍵名／種類描述／所採預設、**不含傳入之值**,鍵名僅短識別字才帶入;出口為 `opt.funLog`(函數,以 `(msg, { fn, reason, key })` 呼叫,出口拋錯忽略),未給則 `console.warn`;同鍵同因每個行程只警告一次(去重表上限 256);格式例 `[w-package-tools-e2e waitDrawerReady] invalid opt.timeout: must be a positive number up to 2147483647, using default 10000`.`reason` 為 `selector`(非字串／空白)、`selector-syntax`(無法解析)、`timeout`、`read`(存取器拋錯)、`unknown`(未宣告之鍵).本函數自帶最小實作(`parseOpt`／`emit`),因 wsemi 之 opt 解析模組(`_numOpt.mjs`)為內部檔不由入口匯出;待 wsemi 提供公開之 opt 解析函數後收編.
- **R4d 必須參數不在本規則內**: `page` 未給或非 Page 仍由 Playwright 拋 TypeError(未改,屬 K2 之範圍外).
- **R5 元件改版複驗**: `test/tools/probeWDrawerDom.mjs` 斷言預設選擇器只命中 1 個 `w-drawer`;套件測試以模擬結構(`KINDS`)驗行為,**不能**代替真元件複驗(元件改寫時測試仍綠).

## 3. 輸入空間(`test/e2e-waitDrawerReady.test.mjs`)

| 軸 | 成員 |
|---|---|
| A 他種元件 | WDialog、浮層(`.WPopperFix`)、WListExpandItem、WGroupTags、WGroupDragdrop(5) |
| B 各元件之 state 值 | 依表 §1 值域(4＋3＋4＋2＋2 = 15) |
| C 抽屜情境 | 頁面無 WDrawer／WDrawer opened／WDrawer hidden(3) |
| D WDrawer 過渡 | opening→opened、hiding→hidden、opening 且他種元件停在 opening、多抽屜（opened＋opening）、停在 opening 逾時、值域外之 state |
| E opt.selector | `'[state]'`(還原舊行為)、自訂 `#id`(元素不帶辨識屬性)、前後帶空白之合法選擇器、命中元素 state 在值域外;非預期者(`''`、`'  '`、`123`、`true`、`false`、`{}`、`[]`、函數、`'##bad'`、`'[[x'`、`'div >'`)→ 預設選擇器(各驗「立即放行」與「仍等待」兩面);`undefined`／`null`;非法選擇器且無 WDrawer |
| F opt.timeout | 非預期者(`0`、`-1`、`NaN`、`±Infinity`、`''`、`'  '`、`'abc'`、`'5s'`、`'0x10'`、`'1e400'`、`'-5'`、`'0'`、`true`、`false`、`{}`、`[]`、函數、`2147483648`、`'2147483648'`)→ 預設 10000(不立即放行);`0` 於 WDrawer 一直 opening 時約 10 秒後回;有效者(`700`、`'700'`、`' 700 '`、`'7e2'`、`700.5`)轉換後使用;`undefined`／`null` |
| G opt.debug | 未給／非 true(`false`、`'true'`、`1`、`{}`、`null`)不警告且 funLog 不被呼叫;true 時 console.warn;funLog(含非函數、拋錯);訊息不含傳入之值與過長之鍵名;去重與 `resetWarned`;未宣告之鍵;合法 opt 不警告(含 `2147483647`、`'2147483647'`、`0.001`);`2147483648` 警告;存取器拋錯 |
| H opt 本身 | `null`、`undefined`、陣列／Date／類別實例／函數(帶 `selector:'[state]'`、`timeout:4000` 屬性,須不被採用)、數字、字串、`true`;各鍵為 `null`;原型為 null 之凍結物件(採用其鍵、不改寫) |

格: A×B×C = 45 格(每格預期「立即放行且不改動該元素」)＋ 多元件同時過渡 1 ＋ D 6 ＋ E 7 ＋ F 4 ＋ G 12 ＋ H 3,共 78 條(E、F、H 內含迴圈,斷言格數更多;2026-11-01 實跑 78 passing).

## 4. 已知限制

- 預設選擇器靠元件內部屬性 `changedrawerwidth`;元件改版移除時靜默放行(R5 複驗、`opt.selector` 為對策).
- `waitDrawerReady` 不再順帶等 WDialog、浮層過場落定(2.5.35 前它們無 `state`,本就未被等);要等者另寫等待或以 `opt.selector` 納入(如 `'[state][changedrawerwidth], [state].WPopperFix'`).是否另提供「等所有 w-component-vue 過場」之新函數,未做(無需求,見報告待裁示).
- 選擇器中的 `[state][changedrawerwidth]` 寫小寫;HTML 文件內屬性名不分大小寫,Vue 以 `setAttribute('changeDrawerWidth', …)` 寫入亦被轉小寫(測試夾具以此方式建立).

## 5. 變更紀錄

- 2026-11-01(pte35b,主控複審後): `opt.selector` 之非字串、空白字串、無法解析原為拋錯,改依 K3 視為未給、改用預設;`opt.timeout` 原未檢測(數字字串、0、負數交給 Playwright),改為大於 0 且不超過 2147483647 之有效數字才採用(轉換後使用),否則 10000;`opt=null` 原拋 TypeError,改視為 `{}`;新增 `opt.debug`／`opt.funLog`(R4b、R4c).簽名、預設逾時、逾時不拋錯不變.
- 2026-11-01(Gitea #35): 裸 `[state]` → `[state][changedrawerwidth]`;新增 `opt.selector`;不動標準圖像素;使用端(用 WDrawer 者)無須改動,自家 `state` 元件須傳 `selector`(README §5).既有測試夾具(`e2e-browserPrimitives`、`e2e-captureEquivalence` 之 `PAGE`)補 WDrawer 辨識屬性.
