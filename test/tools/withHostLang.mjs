//withHostLang, 測試輔助(供 api-launchBrowserWiring、e2e-launchBrowserLang 與 launchBrowserCmdline 共用):
//於 fn 執行期間以替身取代 Intl.DateTimeFormat, 使 w-playwright 取得之主機系統語系(Intl.DateTimeFormat().resolvedOptions().locale; 其於每次合併時才讀取、不快取)為 lang;
//用以模擬不同主機語系, 使測試不隨執行機器之實際系統語系而變(否則於繁中主機上, 預設行為與「固定 --lang=zh-TW」之結果相同而分不出對錯); fn 結束(含拋錯)後還原
//fn 之期間須涵蓋 launchBrowser 之整個呼叫(w-playwright 於啟動時合併參數), 不須涵蓋其後之頁面操作
async function withHostLang(lang, fn) {
    let orig = Intl.DateTimeFormat
    Intl.DateTimeFormat = function() {
        return { resolvedOptions: () => ({ locale: lang }) }
    }
    try {
        return await fn()
    }
    finally {
        Intl.DateTimeFormat = orig
    }
}


export default withHostLang
