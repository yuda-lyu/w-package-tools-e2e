import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import warnDistStale from '../src/warnDistStale.mjs'
import createDistGuard from '../src/createDistGuard.mjs'


//排程第 604 項③(dist 舊於 src 之告警)、④(dist 暫時覆蓋與原位元組還原); 中介資料落 ./test/_tmp/distTools(gitignore), 測完刪除
let fdTmp = path.resolve('./test/_tmp/distTools')

let write = (fp, s, mtimeSec = null) => {
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, s)
    if (mtimeSec !== null) {
        fs.utimesSync(fp, mtimeSec, mtimeSec)
    }
}
let sha = (fp) => crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')

//以相對路徑列出目錄樹之 { 檔: sha256 } 與目錄清單(不跟進連結)
let snap = (dir) => {
    if (!fs.existsSync(dir)) {
        return null
    }
    let files = {}
    let dirs = []
    let walk = (rel) => {
        for (let d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            let r = rel ? `${rel}/${d.name}` : d.name
            if (d.isDirectory()) {
                dirs.push(r)
                walk(r)
            }
            else {
                files[r] = { sha: sha(path.join(dir, r)), mtimeMs: Math.round(fs.statSync(path.join(dir, r)).mtimeMs) }
            }
        }
    }
    walk('')
    return { files, dirs: dirs.sort() }
}


describe('warnDistStale(排程第 604 項③)', function() {

    let proj = null
    beforeEach(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        proj = path.join(fdTmp, 'stale')
    })
    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //各檔時間逐筆相異(看值即知哪一檔), 最新者不在第一個檔
    let T = 1800000000

    it('[DS-01] src 之最新檔晚於 dist 之最新檔: stale:true、reason:stale, 告警含兩者之最新檔與時間、且註明不擋測試', function() {
        write(path.join(proj, 'src', 'a.mjs'), 'a', T + 10)
        write(path.join(proj, 'src', 'sub', 'b.vue'), 'b', T + 30)
        write(path.join(proj, 'dist', 'js', 'app.js'), 'x', T + 20)
        write(path.join(proj, 'dist', 'index.html'), 'y', T + 5)
        let logs = []
        let r = warnDistStale({ projRoot: proj, log: (s) => logs.push(s) })
        assert.strict.equal(r.stale, true)
        assert.strict.equal(r.reason, 'stale')
        assert.strict.deepStrictEqual([r.srcNewest.file, r.distNewest.file], ['src/sub/b.vue', 'dist/js/app.js'])
        assert.strict.equal(logs.length, 1)
        assert.strict.ok(logs[0].startsWith('[dist-stale] dist/ 舊於原始碼'), logs[0])
        for (let s of ['src/sub/b.vue', 'dist/js/app.js', new Date((T + 30) * 1000).toISOString(), new Date((T + 20) * 1000).toISOString(), '本告警不擋測試']) {
            assert.strict.ok(logs[0].includes(s), `告警應含 ${s}: ${logs[0]}`)
        }
    })

    it('[DS-02] dist 之最新檔不早於 src 之最新檔: stale:false、不告警(含時間相等)', function() {
        write(path.join(proj, 'src', 'a.mjs'), 'a', T + 10)
        write(path.join(proj, 'dist', 'a.js'), 'x', T + 11)
        let logs = []
        assert.strict.deepStrictEqual(warnDistStale({ projRoot: proj, log: (s) => logs.push(s) }).stale, false)
        fs.utimesSync(path.join(proj, 'dist', 'a.js'), T + 10, T + 10)
        assert.strict.deepStrictEqual(warnDistStale({ projRoot: proj, log: (s) => logs.push(s) }).reason, 'ok')
        assert.strict.deepStrictEqual(logs, [])
    })

    it('[DS-03] dist 不存在或為空目錄: stale:true、reason:no-dist 並告警; src 不存在: stale:null、reason:no-src、不告警', function() {
        write(path.join(proj, 'src', 'a.mjs'), 'a', T)
        let logs = []
        let r1 = warnDistStale({ projRoot: proj, log: (s) => logs.push(s) })
        fs.mkdirSync(path.join(proj, 'dist'))
        let r2 = warnDistStale({ projRoot: proj, log: (s) => logs.push(s) })
        assert.strict.deepStrictEqual([r1.stale, r1.reason, r2.stale, r2.reason], [true, 'no-dist', true, 'no-dist'])
        assert.strict.equal(logs.length, 2)
        assert.strict.ok(logs.every((s) => s.startsWith('[dist-stale] dist/ 不存在或無檔案')))
        let logs2 = []
        let r3 = warnDistStale({ projRoot: path.join(fdTmp, 'none'), log: (s) => logs2.push(s) })
        assert.strict.deepStrictEqual([r3.stale, r3.reason, logs2], [null, 'no-src', []])
    })

    it('[DS-04] 多個 srcDirs 取最新者(不存在者略過); ignore 命中之檔不計; distDir 可指定', function() {
        write(path.join(proj, 'src', 'a.mjs'), 'a', T + 1)
        write(path.join(proj, 'public', 'index.html'), 'p', T + 9)
        write(path.join(proj, 'src', 'assets', 'big.png'), 'g', T + 50)
        write(path.join(proj, 'build', 'x.js'), 'x', T + 5)
        let logs = []
        let r = warnDistStale({ projRoot: proj, srcDirs: ['src', 'public', 'nope'], distDir: 'build', ignore: [/^src\/assets\//], log: (s) => logs.push(s) })
        assert.strict.deepStrictEqual([r.stale, r.srcNewest.file, r.distNewest.file], [true, 'public/index.html', 'build/x.js'])
        let r2 = warnDistStale({ projRoot: proj, srcDirs: 'src', distDir: 'build', log: null })
        assert.strict.deepStrictEqual([r2.stale, r2.srcNewest.file], [true, 'src/assets/big.png'])
    })

    it('[DS-05] 不跟進目錄連結(連結目標內之較新檔不計)', function() {
        write(path.join(proj, 'src', 'a.mjs'), 'a', T + 1)
        write(path.join(proj, 'dist', 'a.js'), 'x', T + 5)
        write(path.join(fdTmp, 'elsewhere', 'new.mjs'), 'n', T + 99)
        fs.symlinkSync(path.join(fdTmp, 'elsewhere'), path.join(proj, 'src', 'lnk'), 'junction')
        try {
            let r = warnDistStale({ projRoot: proj, log: null })
            assert.strict.deepStrictEqual([r.stale, r.srcNewest.file], [false, 'src/a.mjs'])
        }
        finally {
            fs.rmdirSync(path.join(proj, 'src', 'lnk'))
        }
        assert.strict.ok(fs.existsSync(path.join(fdTmp, 'elsewhere', 'new.mjs')), '連結目標完好')
    })

    it('[DS-07] ignore 帶 g 旗標之 RegExp 亦逐檔一致(lastIndex 不殘留)', function() {
        write(path.join(proj, 'src', 'a.png'), 'a', T + 50)
        write(path.join(proj, 'src', 'b.png'), 'b', T + 60)
        write(path.join(proj, 'src', 'c.mjs'), 'c', T + 1)
        write(path.join(proj, 'dist', 'x.js'), 'x', T + 5)
        let r = warnDistStale({ projRoot: proj, ignore: [/\.png$/g], log: null })
        assert.strict.deepStrictEqual([r.stale, r.srcNewest.file], [false, 'src/c.mjs'])
    })

    it('[DS-06] opt 之非預期輸入視為未給、改用預設(K3, 不拋錯); 讀取失敗不拋錯(reason:error 並告警)', function() {
        write(path.join(proj, 'src', 'a.mjs'), 'a', T + 9)
        write(path.join(proj, 'src', 'b.png'), 'b', T + 1)
        write(path.join(proj, 'dist', 'a.js'), 'x', T + 5)
        //srcDirs 空陣列 → ['src']; distDir 數字 → 'dist'; ignore 含非 RegExp → [](不忽略); log 非函數 → console.warn
        let warns = []
        let orig = console.warn
        console.warn = (s) => warns.push(String(s))
        let r0
        try {
            r0 = warnDistStale({ projRoot: proj, srcDirs: [], distDir: 1, ignore: ['x'], log: 'x' })
        }
        finally {
            console.warn = orig
        }
        assert.strict.deepStrictEqual([r0.stale, r0.reason, r0.srcNewest.file, r0.distNewest.file], [true, 'stale', 'src/a.mjs', 'dist/a.js'])
        assert.strict.ok(warns.length === 1 && warns[0].startsWith('[dist-stale]'), warns.join('|'))
        //projRoot 空字串 → process.cwd()(本套件根: 有 src、無 dist)
        let r1 = warnDistStale({ projRoot: '', log: null })
        assert.strict.deepStrictEqual([r1.reason, r1.srcNewest && r1.srcNewest.file.startsWith('src/')], ['no-dist', true])
        fs.utimesSync(path.join(proj, 'src', 'a.mjs'), T, T)
        fs.utimesSync(path.join(proj, 'src', 'b.png'), T, T)
        fs.utimesSync(path.join(proj, 'dist', 'a.js'), T, T)
        let logs = []
        //以 test 拋錯之 RegExp 模擬讀取途中失敗
        let reBoom = /x/
        reBoom.test = () => {
            throw new Error('boom')
        }
        let r = warnDistStale({ projRoot: proj, ignore: [reBoom], log: (s) => logs.push(s) })
        assert.strict.deepStrictEqual([r.stale, r.reason], [null, 'error'])
        assert.strict.ok(logs.length === 1 && logs[0].includes('無法比對') && logs[0].includes('boom'), logs.join('|'))
    })

})


describe('createDistGuard(排程第 604 項④)', function() {

    let proj = null
    let fdDist = null
    let fdSnap = null
    let T = 1800000000
    //原 dist: 逐檔內容與時間相異; 含巢狀目錄與空目錄
    let mkOrig = () => {
        write(path.join(fdDist, 'index.tmp'), 'idx-0', T + 1)
        write(path.join(fdDist, 'js', 'app.1111.js'), 'app-1', T + 2)
        write(path.join(fdDist, 'js', 'chunk.2222.js'), 'chunk-2', T + 3)
        write(path.join(fdDist, 'css', 'app.3333.css'), 'css-3', T + 4)
        fs.mkdirSync(path.join(fdDist, 'empty'), { recursive: true })
    }
    //模擬建置: 刪一檔、改一檔、多一檔與一目錄
    let mutate = () => {
        fs.rmSync(path.join(fdDist, 'js', 'chunk.2222.js'))
        write(path.join(fdDist, 'index.tmp'), 'idx-NEW')
        write(path.join(fdDist, 'js', 'app.9999.js'), 'app-9')
        write(path.join(fdDist, 'newdir', 'x.txt'), 'x')
    }
    beforeEach(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        proj = path.join(fdTmp, 'guard')
        fdDist = path.join(proj, 'dist')
        fdSnap = path.join(proj, 'test', '_tmp', 'dist-guard')
        fs.mkdirSync(proj, { recursive: true })
    })
    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('[DG-01] start → 建置改動(刪、改、增檔與目錄) → restore: 位元組、修改時間、檔案與目錄清單皆回到原狀, 備份刪除', function() {
        mkOrig()
        let before = snap(fdDist)
        let g = createDistGuard({ projRoot: proj, log: null })
        assert.strict.deepStrictEqual(g.start(), { staleRestored: false, existed: true, nFiles: 4 })
        mutate()
        let st = g.status()
        assert.strict.deepStrictEqual([st.backedUp, st.same, st.extra, st.missing, st.changed, st.extraDirs], [true, false, ['js/app.9999.js', 'newdir/x.txt'], ['js/chunk.2222.js'], ['index.tmp'], ['newdir']])
        assert.strict.deepStrictEqual(g.restore(), { restored: true, nFiles: 4 })
        assert.strict.deepStrictEqual(snap(fdDist), before)
        assert.strict.equal(fs.existsSync(fdSnap), false, '還原回驗通過後刪除備份')
        assert.strict.deepStrictEqual(g.restore(), { restored: false, nFiles: 0 }, '無備份時不動作')
    })

    it('[DG-02] 崩潰自癒: 建置後未 restore(被強制結束) → 下次 start 先還原再重新備份, 最終 dist 回到第一次備份時之位元組', function() {
        mkOrig()
        let before = snap(fdDist)
        createDistGuard({ projRoot: proj, log: null }).start()
        mutate()
        //(行程被結束: 不呼叫 restore)
        let logs = []
        let g2 = createDistGuard({ projRoot: proj, log: (s) => logs.push(s) })
        assert.strict.deepStrictEqual(g2.start(), { staleRestored: true, existed: true, nFiles: 4 })
        assert.strict.deepStrictEqual(snap(fdDist), before, '自癒後 dist 已回原狀')
        assert.strict.ok(logs.some((s) => s.startsWith('[dist-guard] 前次未還原')), logs.join('|'))
        mutate()
        g2.restore()
        assert.strict.deepStrictEqual(snap(fdDist), before)
    })

    it('[DG-03] 崩潰於備份途中(manifest 未寫): dist 未被動; 下次 start 丟棄不完整備份重做, 之後之還原完整', function() {
        mkOrig()
        let before = snap(fdDist)
        let n = 0
        let g = createDistGuard({
            projRoot: proj,
            log: null,
            onStep: ({ phase }) => {
                if (phase === 'backup' && ++n === 2) {
                    throw new Error('模擬被結束')
                }
            },
        })
        assert.throws(() => g.start(), /模擬被結束/)
        assert.strict.equal(fs.existsSync(path.join(fdSnap, 'manifest.json')), false, '備份途中不得已有 manifest')
        assert.strict.deepStrictEqual(snap(fdDist), before)
        let g2 = createDistGuard({ projRoot: proj, log: null })
        assert.strict.deepStrictEqual(g2.start(), { staleRestored: false, existed: true, nFiles: 4 })
        mutate()
        g2.restore()
        assert.strict.deepStrictEqual(snap(fdDist), before)
    })

    it('[DG-04] 崩潰於還原途中(dist 已清空、只寫回部分): 備份與 manifest 保留, 下次 start 自癒為原狀', function() {
        mkOrig()
        let before = snap(fdDist)
        let n = 0
        let g = createDistGuard({
            projRoot: proj,
            log: null,
            onStep: ({ phase }) => {
                if (phase === 'restore' && ++n === 2) {
                    throw new Error('模擬被結束')
                }
            },
        })
        g.start()
        mutate()
        assert.throws(() => g.restore(), /模擬被結束/)
        assert.strict.ok(fs.existsSync(path.join(fdSnap, 'manifest.json')), '還原未完成時保留 manifest')
        assert.strict.notDeepStrictEqual(snap(fdDist), before, '前提: 中途結束時 dist 為不完整狀態')
        let g2 = createDistGuard({ projRoot: proj, log: null })
        assert.strict.equal(g2.start().staleRestored, true)
        assert.strict.deepStrictEqual(snap(fdDist), before)
        g2.restore()
        assert.strict.deepStrictEqual(snap(fdDist), before)
    })

    it('[DG-05] useBuild: replace 使 dist 與建置目錄完全相同、overlay 只覆蓋同名檔; 兩者皆可原位元組還原; 未 start 即拋錯', function() {
        mkOrig()
        let before = snap(fdDist)
        let fdBuild = path.join(proj, 'tmp', 'build')
        write(path.join(fdBuild, 'index.html'), 'new-index')
        write(path.join(fdBuild, 'js', 'app.1111.js'), 'app-NEW')
        write(path.join(fdBuild, 'js', 'app.7777.js'), 'app-7')
        let g = createDistGuard({ projRoot: proj, log: null })
        assert.throws(() => g.useBuild(fdBuild), /useBuild 前須先 start/)
        g.start()
        assert.strict.deepStrictEqual(g.useBuild(fdBuild), { nFiles: 3 })
        assert.strict.deepStrictEqual(Object.keys(snap(fdDist).files).sort(), ['index.html', 'js/app.1111.js', 'js/app.7777.js'])
        assert.strict.equal(fs.readFileSync(path.join(fdDist, 'js', 'app.1111.js'), 'utf8'), 'app-NEW')
        g.restore()
        assert.strict.deepStrictEqual(snap(fdDist), before)
        g.start()
        g.useBuild(fdBuild, { mode: 'overlay' })
        let s = snap(fdDist)
        assert.strict.deepStrictEqual(Object.keys(s.files).sort(), ['css/app.3333.css', 'index.html', 'index.tmp', 'js/app.1111.js', 'js/app.7777.js', 'js/chunk.2222.js'])
        assert.strict.equal(fs.readFileSync(path.join(fdDist, 'js', 'app.1111.js'), 'utf8'), 'app-NEW')
        g.restore()
        assert.strict.deepStrictEqual(snap(fdDist), before)
        assert.throws(() => createDistGuard({ projRoot: proj, log: null }).useBuild(fdBuild, { mode: 'merge' }), /mode 須為/)
    })

    it('[DG-06] 備份時 dist 不存在: 建置產生之 dist 於還原時移除; status 列出多餘', function() {
        let g = createDistGuard({ projRoot: proj, log: null })
        assert.strict.deepStrictEqual(g.start(), { staleRestored: false, existed: false, nFiles: 0 })
        write(path.join(fdDist, 'js', 'a.js'), 'a')
        let st = g.status()
        assert.strict.deepStrictEqual([st.same, st.extra, st.extraDirs], [false, ['js/a.js'], ['.', 'js']])
        g.restore()
        assert.strict.equal(fs.existsSync(fdDist), false)
    })

    it('[DG-07] dist 內有目錄連結: start 拋錯且未建立備份、連結與其目標皆未被動; 建置後才出現之連結: restore 拋錯不刪、備份保留', function() {
        mkOrig()
        let fdTarget = path.join(fdTmp, 'linkTarget')
        write(path.join(fdTarget, 'keep.txt'), 'keep')
        let lnk = path.join(fdDist, 'lnk')
        fs.symlinkSync(fdTarget, lnk, 'junction')
        try {
            let g = createDistGuard({ projRoot: proj, log: null })
            assert.throws(() => g.start(), /為目錄連結或符號連結/)
            assert.strict.equal(fs.existsSync(path.join(fdSnap, 'manifest.json')), false)
        }
        finally {
            fs.rmdirSync(lnk)
        }
        let g = createDistGuard({ projRoot: proj, log: null })
        g.start()
        fs.symlinkSync(fdTarget, lnk, 'junction')
        try {
            assert.throws(() => g.restore(), /為目錄連結或符號連結/)
            assert.strict.ok(fs.existsSync(path.join(fdSnap, 'manifest.json')), '備份保留')
            assert.strict.ok(fs.existsSync(path.join(fdDist, 'js', 'app.1111.js')), 'dist 未被刪')
        }
        finally {
            fs.rmdirSync(lnk)
        }
        assert.strict.equal(fs.readFileSync(path.join(fdTarget, 'keep.txt'), 'utf8'), 'keep', '連結目標完好')
        g.restore()
    })

    it('[DG-08] 還原後回驗: 備份檔被竄改時拋錯且保留備份(不宣告成功)', function() {
        mkOrig()
        let g = createDistGuard({ projRoot: proj, log: null })
        g.start()
        mutate()
        fs.writeFileSync(path.join(fdSnap, 'files', 'css', 'app.3333.css'), 'tampered')
        assert.throws(() => g.restore(), /還原後與備份不符\(多 0、缺 0、內容不同 1/)
        assert.strict.ok(fs.existsSync(path.join(fdSnap, 'manifest.json')), '回驗不符時保留備份')
    })

    it('[DG-09] 路徑守門: distDir 為磁碟根、projRoot 或其祖先, snapDir 與 distDir 相同或互為祖孫, 空字串, 皆於建立時拋錯(未動任何檔)', function() {
        assert.throws(() => createDistGuard({ projRoot: proj, distDir: path.parse(proj).root }), /磁碟根/)
        assert.throws(() => createDistGuard({ projRoot: proj, distDir: '.' }), /projRoot 或其祖先/)
        assert.throws(() => createDistGuard({ projRoot: proj, distDir: '..' }), /projRoot 或其祖先/)
        assert.throws(() => createDistGuard({ projRoot: proj, snapDir: 'dist' }), /互為祖孫/)
        assert.throws(() => createDistGuard({ projRoot: proj, snapDir: 'dist/bak' }), /互為祖孫/)
        assert.throws(() => createDistGuard({ projRoot: proj, distDir: 'tmp/x/dist', snapDir: 'tmp' }), /互為祖孫/)
        assert.throws(() => createDistGuard({ projRoot: proj, distDir: '' }), /distDir 須為非空字串/)
        //兩者皆為遞迴刪除之對象: 須在 projRoot 之內且不得為 projRoot
        assert.throws(() => createDistGuard({ projRoot: proj, distDir: '../other' }), /distDir 須在 projRoot 之內/)
        assert.throws(() => createDistGuard({ projRoot: proj, snapDir: '../bak' }), /snapDir 須在 projRoot 之內/)
        assert.throws(() => createDistGuard({ projRoot: proj, snapDir: '.' }), /snapDir 須在 projRoot 之內/)
        assert.strict.deepStrictEqual(fs.readdirSync(proj), [])
    })

    it('[DG-10] snapDir 誤指到既有目錄(內有非本工具之檔): start 拋錯且不刪該目錄、不動 dist', function() {
        mkOrig()
        let before = snap(fdDist)
        write(path.join(proj, 'src', 'main.mjs'), 'keep-src')
        let g = createDistGuard({ projRoot: proj, snapDir: 'src', log: null })
        assert.throws(() => g.start(), /snapDir 內有非本工具所建之項目\(main\.mjs\), 不刪除/)
        assert.strict.equal(fs.readFileSync(path.join(proj, 'src', 'main.mjs'), 'utf8'), 'keep-src')
        assert.strict.deepStrictEqual(snap(fdDist), before)
    })

    it('[DG-11] 持有者行程仍存活: 他行程之 start 拋錯、不自癒不動 dist; 持有者結束後 start 照常自癒', async function() {
        mkOrig()
        let before = snap(fdDist)
        createDistGuard({ projRoot: proj, log: null }).start()
        mutate()
        let mid = snap(fdDist)
        //以一個存活之子行程代表「持有者」: 把 manifest 之 pid 改為其 PID
        let { spawn } = await import('child_process')
        let child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
        try {
            await new Promise((resolve) => child.once('spawn', resolve))
            let fpM = path.join(fdSnap, 'manifest.json')
            let m = JSON.parse(fs.readFileSync(fpM, 'utf8'))
            assert.strict.equal(m.pid, process.pid, 'manifest 記錄持有者 PID')
            fs.writeFileSync(fpM, JSON.stringify({ ...m, pid: child.pid }))
            assert.throws(() => createDistGuard({ projRoot: proj, log: null }).start(), new RegExp(`備份由仍在執行之行程 ${child.pid} 持有`))
            assert.strict.deepStrictEqual(snap(fdDist), mid, '持有者存活時不動 dist')
        }
        finally {
            child.kill()
            await new Promise((resolve) => child.once('exit', resolve))
        }
        let g = createDistGuard({ projRoot: proj, log: null })
        assert.strict.equal(g.start().staleRestored, true)
        assert.strict.deepStrictEqual(snap(fdDist), before)
        g.restore()
    })

    it('[DG-12] manifest 損毀: start／restore／status 皆拋錯(含 manifest 字樣), 不當成無備份、不動 dist 與備份', function() {
        mkOrig()
        let g = createDistGuard({ projRoot: proj, log: null })
        g.start()
        mutate()
        let mid = snap(fdDist)
        fs.writeFileSync(path.join(fdSnap, 'manifest.json'), '{bad json')
        for (let fn of [() => createDistGuard({ projRoot: proj, log: null }).start(), () => g.restore(), () => g.status()]) {
            assert.throws(fn, /manifest 無法讀取或解析/)
        }
        assert.strict.deepStrictEqual(snap(fdDist), mid)
        assert.strict.ok(fs.existsSync(path.join(fdSnap, 'files', 'index.tmp')), '備份保留')
    })

    it('[DG-13] 備份時 dist 不存在而建置後被結束: 下次 start 自癒(移除建置產生之 dist)', function() {
        createDistGuard({ projRoot: proj, log: null }).start()
        write(path.join(fdDist, 'js', 'a.js'), 'a')
        let g = createDistGuard({ projRoot: proj, log: null })
        assert.strict.deepStrictEqual(g.start(), { staleRestored: true, existed: false, nFiles: 0 })
        assert.strict.equal(fs.existsSync(fdDist), false)
        g.restore()
    })

})
