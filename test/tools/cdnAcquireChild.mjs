//供 test/api-createCdnLocal.test.mjs 起子行程: 以夾具清單與本機伺服器驗「多行程同時首次取得, 每檔只下載一次」與「持鎖行程被強制結束後之接手」
//  用法: node test/tools/cdnAcquireChild.mjs <清單 JSON 路徑> <快取資料夾> <夾具伺服器基底網址> [<createCdnLocal 選項之 JSON>]
//  每個事件印一行 `EV <json>`(含 pid), 結束前印 `DONE`; 失敗印 `ERR <code> <訊息>` 並以離開碼 1 結束
import fs from 'fs'
import createCdnLocal from '../../src/createCdnLocal.mjs'
import { HOST, realFetch } from './cdnLocalFixture.mjs'

let [manifestFp, cacheDir, baseUrl, optJson] = process.argv.slice(2)
let manifest = JSON.parse(fs.readFileSync(manifestFp, 'utf8'))
let extra = optJson ? JSON.parse(optJson) : {}

let cdn = createCdnLocal({
    manifest,
    cacheDir,
    fetch: (u, init) => realFetch(String(u).replace(HOST, baseUrl), init),
    pollMs: 30,
    concurrency: 1,
    retryDelayMs: 10,
    onTrace: (e) => console.log('EV ' + JSON.stringify({ pid: process.pid, ...e })),
    ...extra,
})
try {
    await cdn.ensure()
    console.log('DONE')
}
catch (err) {
    console.log('ERR ' + (err && err.code) + ' ' + (err && err.message))
    process.exitCode = 1
}
