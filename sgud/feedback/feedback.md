# 回饋

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案;只增不改,處置結果另記一列.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-09 | 全域技能 | update-pks | B 類(跨主版號)升版之盤點,對「度量／判定類」依賴(影像比對、版本比較、雜湊、解析器等)應先讀該版 release notes 與原始碼差異,把「語意是否改變、有無選項可還原」寫進建議檔,而不是只列新增選項;本次 pixelmatch 7→8 之建議檔稱「8 新增 checkerboard 預設 true、7 疊白底」,實測 7.2.0 已有且預設 true,真正之不相容(色差度量由 YIQ 改為 OKLab HyAB)未列入,致派工前提不成立、須停下回報 | 7.2.0 `index.js:28`(`checkerboard = true`)、8.0.0 release notes「If your tests rely on exact counts or a tuned threshold, re-check them」、任務報告 pm115 差異清單 |
