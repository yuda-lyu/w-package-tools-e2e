import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'


/**
 * 建立臨時設定檔之產生器：以基底設定(JSON5)淺合併overrides後寫出純JSON，供e2e以不同設定重啟後端
 *
 * 落點須為測試中介資料目錄(例如test/_tmp，gitignore)，絕不可為AI暫存區./tmp(隨時被整個清除，後端讀不到設定即假失敗)。
 * 檔名為`settings-e2e-<pid>-<序號>.json`；cleanupTempSettings逐一刪除本產生器建立之檔案，目錄空了再刪目錄。
 * forbiddenKeys內之鍵不可覆寫(例如測試實例固定之port與log目錄)，覆寫即拋錯
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.basePath 輸入基底設定檔路徑字串(JSON5)，於每次產生時讀取；相對路徑以當下工作目錄解析
 * @param {String} opt.tmpDir 輸入臨時設定檔目錄字串
 * @param {Array} [opt.forbiddenKeys=[]] 輸入不可覆寫之鍵陣列，預設[]
 * @param {String} [opt.prefix='settings-e2e'] 輸入檔名前綴字串，預設'settings-e2e'
 * @returns {Object} 回傳物件{genTempSettings(overrides),cleanupTempSettings(),files()}
 * @example
 *
 * import createTempSettings from 'w-package-tools-e2e/src/createTempSettings.mjs'
 *
 * let { genTempSettings, cleanupTempSettings } = createTempSettings({ basePath: './settings.json', tmpDir: './test/_tmp' })
 * let p = genTempSettings({ allowUserRegistration: false })
 * //...以p重啟後端...
 * cleanupTempSettings()
 *
 */
function createTempSettings(opt = {}) {
    let { basePath, tmpDir, forbiddenKeys = [], prefix = 'settings-e2e' } = opt
    if (!basePath || !tmpDir) {
        throw new Error('createTempSettings: basePath 與 tmpDir 為必填')
    }
    let seq = 0
    let files = []

    function genTempSettings(overrides = {}) {
        for (let k of forbiddenKeys) {
            if (k in overrides) {
                throw new Error(`genTempSettings 不可覆寫 ${k}`)
            }
        }
        let base = JSON5.parse(fs.readFileSync(basePath, 'utf8'))
        let merged = { ...base, ...overrides }
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true })
        }
        let p = path.join(tmpDir, `${prefix}-${process.pid}-${seq++}.json`)
        fs.writeFileSync(p, JSON.stringify(merged, null, 2))
        files.push(p)
        return p
    }

    function cleanupTempSettings() {
        for (let p of files) {
            try {
                fs.rmSync(p, { force: true })
            }
            catch (err) {}
        }
        files = []
        try {
            if (fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length === 0) {
                fs.rmdirSync(tmpDir)
            }
        }
        catch (err) {}
    }

    return {
        genTempSettings,
        cleanupTempSettings,
        files: () => files.slice(),
    }
}


export default createTempSettings
