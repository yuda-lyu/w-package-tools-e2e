//tools/shardE2e.mjs(src/runShardedE2e.mjs)各組 mocha 所用之報告器: 終端輸出同內建 spec, 另把統計寫到環境變數 E2E_SHARD_RESULT 所指之 JSON
//為何不解析 log 文字: 測試自身之輸出可含「3 failing」; 各檔耗時要靠 suite 事件才量得到(spec 輸出不含檔名)
//須為 CJS: mocha 以 require 載入報告器。mocha 取自工作目錄(實例根)之 node_modules, 與執行中之 mocha 同一份
'use strict'
const fs = require('fs')
const path = require('path')
const Mocha = require(require.resolve('mocha', { paths: [process.cwd()] }))

const {
    EVENT_SUITE_BEGIN,
    EVENT_SUITE_END,
    EVENT_TEST_PASS,
    EVENT_TEST_FAIL,
    EVENT_TEST_PENDING,
    EVENT_RUN_END,
} = Mocha.Runner.constants


class ShardE2eReporter extends Mocha.reporters.Spec {

    constructor(runner, options) {
        super(runner, options)
        let fp = process.env.E2E_SHARD_RESULT || ''
        let st = {
            done: false,
            total: runner.total,
            passing: 0,
            failing: 0,
            pending: 0,
            failures: [],
            fileMs: {},
        }
        //寫檔失敗不得影響測試本身; 無此統計時工具判為未跑完
        let write = () => {
            if (!fp) {
                return
            }
            try {
                fs.writeFileSync(fp, JSON.stringify(st))
            }
            catch (err) {}
        }
        let starts = new Map()
        runner.on(EVENT_SUITE_BEGIN, (suite) => {
            if (suite.parent && suite.parent.root && suite.file) {
                starts.set(suite, Date.now())
            }
        })
        runner.on(EVENT_SUITE_END, (suite) => {
            if (starts.has(suite)) {
                let k = path.basename(suite.file)
                st.fileMs[k] = (st.fileMs[k] || 0) + (Date.now() - starts.get(suite))
                write()
            }
        })
        runner.on(EVENT_TEST_PASS, () => {
            st.passing++
            write()
        })
        runner.on(EVENT_TEST_PENDING, () => {
            st.pending++
            write()
        })
        runner.on(EVENT_TEST_FAIL, (test) => {
            st.failing++
            let file = test.file || (test.parent && test.parent.file) || ''
            st.failures.push({ title: test.fullTitle(), file: file ? path.basename(file) : '' })
            write()
        })
        //測試層以 root after 呼叫 process.exit 時 run end 不會發生: 每個事件皆已寫檔, 工具由 total 判定是否跑完
        runner.once(EVENT_RUN_END, () => {
            st.done = true
            write()
        })
        write()
    }

}


module.exports = ShardE2eReporter
