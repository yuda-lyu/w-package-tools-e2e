# 回饋

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案;只增不改,處置結果另記一列.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-09 | 自有套件 | 其他自有套件(自行手寫 pixelmatch 比對者,共 3 個,測試輔助檔內各有 1～2 處呼叫) | 該等套件各自內嵌 `pixelmatch(..., { includeAA:false, threshold:0.1 })`、容差常數(60／100 不一)與失敗證據存檔邏輯,升 pixelmatch 8 時須逐處改選項、逐套件重做判定;已有足夠多之同形功能,宜改由本套件之 `assertBaselineMatch`(深層引用,不載入 playwright)與 `pixelmatchOpt` 單一來源提供,或抽提為更輕之自有套件,避免度量與選項再次分叉 | 本輪對該 3 套件 `test/` 之 `pixelmatch(` 呼叫盤點(僅讀);本套件 `src/pixelmatchOpt.mjs`、README §5〈pixelmatch 8 之比對度量〉 |
| 2026-11-09 | 全域技能 | role-coder-for-test-e2e(§8.4 或 §11 之環境注意) | 同一台機器上多個套件各用不同 playwright 版本時,任一版之 `playwright install` 會回收共用目錄 `%LOCALAPPDATA%\ms-playwright` 內未被登記引用之瀏覽器修訂:實例為他處安裝 playwright 1.65.0 之 chromium_headless_shell-1254 時,本機 1.64.1 對應之 chromium_headless_shell-1248 被刪除,正在以 `executablePath` 指定該修訂之探測腳本啟動失敗(`icu_util.cc: Invalid file descriptor to ICU data`,退出碼 2147483651);經 `launchChromium` 之套件測試會自動重下,以固定 `executablePath` 之探測腳本則不會,宜寫入「跨版本渲染比對之探測不依賴常駐修訂,先確認該目錄存在」 | 本輪 `./tmp/quiet-run` 之 `pm115b-chrome` log(已清除,內容見任務報告 pm115b 第二輪)、`ls %LOCALAPPDATA%\ms-playwright` 前後對照 |
| 2026-11-09 | 全域技能 | update-pks | B 類(跨主版號)升版之盤點,對「度量／判定類」依賴(影像比對、版本比較、雜湊、解析器等)應先讀該版 release notes 與原始碼差異,把「語意是否改變、有無選項可還原」寫進建議檔,而不是只列新增選項;本次 pixelmatch 7→8 之建議檔稱「8 新增 checkerboard 預設 true、7 疊白底」,實測 7.2.0 已有且預設 true,真正之不相容(色差度量由 YIQ 改為 OKLab HyAB)未列入,致派工前提不成立、須停下回報 | 7.2.0 `index.js:28`(`checkerboard = true`)、8.0.0 release notes「If your tests rely on exact counts or a tuned threshold, re-check them」、任務報告 pm115 差異清單 |
