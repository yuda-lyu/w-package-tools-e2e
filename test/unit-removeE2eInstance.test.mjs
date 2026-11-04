import fs from 'fs'
import path from 'path'
import assert from 'assert'
import listDirLinks from '../src/listDirLinks.mjs'
import removeE2eInstance, { snapshotLinkTarget, diffLinkTarget } from '../src/removeE2eInstance.mjs'


//臨時實例之移除(全域技能 full-run-and-instances §5.5): 尚有連結時絕不遞迴刪除; 目標完好以連結目標內之哨兵檔實測
//夾具全在 test/_tmp/removeE2eInstance/, 連結目標亦為夾具(不碰真 node_modules)


let fdRoot = path.resolve('test/_tmp/removeE2eInstance')
let cnt = 0


//會跟進連結之惡意刪除(模擬 robocopy /MIR 穿過 junction): 若呼叫時連結尚在, 目標內之哨兵檔即被刪
function followingRm(dir) {
    for (let name of fs.readdirSync(dir)) {
        let p = path.join(dir, name)
        let stFollow = fs.statSync(p) //跟進連結
        if (stFollow.isDirectory()) {
            followingRm(p)
        }
        else {
            fs.unlinkSync(p)
        }
    }
    fs.rmdirSync(dir)
}


function mk() {
    let base = path.join(fdRoot, `c${++cnt}`)
    let proj = path.join(base, 'proj')
    let work = path.join(proj, 'tmp', 'e2e-shards')
    let inst = path.join(work, 'inst0')
    let dst = path.join(inst, 'proj')
    fs.mkdirSync(path.join(proj, 'node_modules', 'pkg'), { recursive: true })
    fs.mkdirSync(path.join(proj, 'test', 'pics', 'flow'), { recursive: true })
    fs.writeFileSync(path.join(proj, 'node_modules', 'pkg', 'sentinel.txt'), 'nm')
    fs.writeFileSync(path.join(proj, 'test', 'pics', 'flow', 'base.png'), 'pics')
    fs.mkdirSync(path.join(dst, 'test'), { recursive: true })
    fs.writeFileSync(path.join(dst, '.env'), 'SECRET=fixture-only')
    fs.symlinkSync(path.join(proj, 'node_modules'), path.join(dst, 'node_modules'), 'junction')
    fs.symlinkSync(path.join(proj, 'test', 'pics'), path.join(dst, 'test', 'pics'), 'junction')
    let targets = [
        { path: path.join(proj, 'node_modules'), depth: 2, meta: false, allowAdded: true },
        { path: path.join(proj, 'test', 'pics') },
    ]
    let intact = () => {
        return fs.readFileSync(path.join(proj, 'node_modules', 'pkg', 'sentinel.txt'), 'utf8') === 'nm' &&
            fs.readFileSync(path.join(proj, 'test', 'pics', 'flow', 'base.png'), 'utf8') === 'pics'
    }
    return { base, proj, work, inst, dst, targets, intact }
}


//案例結束時拆掉殘留連結(夾具之目標亦在 test/_tmp, 不會波及外部)
function cleanupCase(c) {
    if (fs.existsSync(c.inst)) {
        for (let l of listDirLinks(c.inst)) {
            fs.rmSync(l.path, { force: true, recursive: false })
        }
    }
    fs.rmSync(c.base, { recursive: true, force: true })
}


describe('removeE2eInstance', function() {

    this.timeout(30000)

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    it('[S-R1] 拆連結後才刪除: 以會跟進連結之刪除注入, 目標內哨兵檔仍在、實例已不存在', function() {
        let c = mk()
        let seen = null
        let r = removeE2eInstance({
            instRoot: c.inst,
            workDir: c.work,
            targets: c.targets,
            log: () => {},
            rmDir: (d) => {
                seen = listDirLinks(d).length
                followingRm(d)
            },
        })
        assert.strict.equal(seen, 0) //刪除當下實例內已無連結
        assert.strict.deepEqual(r.links.slice().sort(), ['proj/node_modules', 'proj/test/pics'])
        assert.strict.equal(fs.existsSync(c.inst), false)
        assert.strict.equal(c.intact(), true)
        cleanupCase(c)
    })

    it('[S-R2] 預設刪除實測: 實例含 .env 副本一併刪除, 目標完好', function() {
        let c = mk()
        removeE2eInstance({ instRoot: c.inst, workDir: c.work, targets: c.targets, log: () => {} })
        assert.strict.equal(fs.existsSync(c.inst), false)
        assert.strict.equal(c.intact(), true)
        cleanupCase(c)
    })

    it('[S-R3] testPending 先搬回且不覆蓋: 撞名之證據加 -N, 既有檔內容不變', function() {
        let c = mk()
        let from = path.join(c.dst, 'testPending')
        let to = path.join(c.proj, 'testPending')
        fs.mkdirSync(path.join(from, 'sub'), { recursive: true })
        fs.mkdirSync(to, { recursive: true })
        let ev = 'flow-E2E-001__2026-11-04_07-00-00-000__capture.png'
        fs.writeFileSync(path.join(from, ev), 'new')
        fs.writeFileSync(path.join(from, 'x__collect.json'), 'm')
        fs.writeFileSync(path.join(from, 'sub', 'y.txt'), 'y')
        fs.writeFileSync(path.join(to, ev), 'old')
        let r = removeE2eInstance({ instRoot: c.inst, workDir: c.work, pendingMoves: [{ from, to }], targets: c.targets, log: () => {} })
        assert.strict.equal(fs.readFileSync(path.join(to, ev), 'utf8'), 'old')
        assert.strict.equal(fs.readFileSync(path.join(to, 'flow-E2E-001__2026-11-04_07-00-00-000-1__capture.png'), 'utf8'), 'new')
        assert.strict.equal(fs.readFileSync(path.join(to, 'x__collect.json'), 'utf8'), 'm')
        assert.strict.equal(fs.readFileSync(path.join(to, 'sub', 'y.txt'), 'utf8'), 'y')
        assert.strict.equal(r.moved.length, 3)
        assert.strict.equal(fs.existsSync(c.inst), false)
        cleanupCase(c)
    })

    it('[S-R3b] 非證據格式之檔撞名時序號加在副檔名前; 無 testPending 不報錯', function() {
        let c = mk()
        let from = path.join(c.dst, 'testPending')
        let to = path.join(c.proj, 'testPending')
        fs.mkdirSync(from, { recursive: true })
        fs.mkdirSync(to, { recursive: true })
        fs.writeFileSync(path.join(from, 'a.txt'), 'n')
        fs.writeFileSync(path.join(to, 'a.txt'), 'o')
        fs.writeFileSync(path.join(to, 'a-1.txt'), 'o1')
        removeE2eInstance({
            instRoot: c.inst,
            workDir: c.work,
            pendingMoves: [{ from, to }, { from: path.join(c.dst, 'none'), to }],
            targets: c.targets,
            log: () => {},
        })
        assert.strict.equal(fs.readFileSync(path.join(to, 'a-2.txt'), 'utf8'), 'n')
        cleanupCase(c)
    })

    it('[S-R4] 搬回失敗 → 大聲報錯、未刪除、連結未拆', function() {
        let c = mk()
        let from = path.join(c.dst, 'testPending')
        fs.mkdirSync(from, { recursive: true })
        fs.writeFileSync(path.join(from, 'a.txt'), 'n')
        //to 為既有之檔: mkdir 失敗
        let to = path.join(c.proj, 'blocked')
        fs.writeFileSync(to, 'file')
        let rmCalled = false
        assert.throws(() => removeE2eInstance({
            instRoot: c.inst,
            workDir: c.work,
            pendingMoves: [{ from, to }],
            targets: c.targets,
            log: () => {},
            rmDir: () => {
                rmCalled = true
            },
        }), (err) => err.step === 'pending' && /實例未刪除/.test(err.message))
        assert.strict.equal(rmCalled, false)
        assert.strict.equal(listDirLinks(c.inst).length, 2)
        assert.strict.equal(fs.existsSync(path.join(from, 'a.txt')), true)
        cleanupCase(c)
    })

    it('[S-R5] 目標不完好(expect 與現況不符)→ 大聲報錯、不刪除', function() {
        let c = mk()
        let expect = snapshotLinkTarget(path.join(c.proj, 'test', 'pics'))
        fs.writeFileSync(path.join(c.proj, 'test', 'pics', 'flow', 'new.png'), 'x')
        let rmCalled = false
        assert.throws(() => removeE2eInstance({
            instRoot: c.inst,
            workDir: c.work,
            targets: [c.targets[0], { path: path.join(c.proj, 'test', 'pics'), expect }],
            log: () => {},
            rmDir: () => {
                rmCalled = true
            },
        }), (err) => err.step === 'targets' && /連結目標不完好/.test(err.message) && /多出 1 項/.test(err.message))
        assert.strict.equal(rmCalled, false)
        assert.strict.equal(fs.existsSync(path.join(c.dst, '.env')), true)
        cleanupCase(c)
    })

    it('[S-R6] 刪除失敗或刪除後仍存在 → 大聲報錯', function() {
        let c = mk()
        assert.throws(() => removeE2eInstance({
            instRoot: c.inst,
            workDir: c.work,
            targets: c.targets,
            log: () => {},
            rmDir: () => {
                throw new Error('EBUSY')
            },
        }), (err) => err.step === 'rm' && /EBUSY/.test(err.message))
        cleanupCase(c)
        let c2 = mk()
        assert.throws(() => removeE2eInstance({
            instRoot: c2.inst,
            workDir: c2.work,
            targets: c2.targets,
            log: () => {},
            rmDir: () => {},
        }), (err) => err.step === 'rm' && /刪除後仍存在/.test(err.message))
        cleanupCase(c2)
    })

    it('[S-R7] 刪除過程傷及目標 → targetsAfter 報錯(目標完好不可只看沒有報錯)', function() {
        let c = mk()
        assert.throws(() => removeE2eInstance({
            instRoot: c.inst,
            workDir: c.work,
            targets: c.targets,
            log: () => {},
            rmDir: (d) => {
                fs.rmSync(d, { recursive: true, force: true })
                fs.rmSync(path.join(c.proj, 'node_modules', 'pkg'), { recursive: true, force: true })
            },
        }), (err) => err.step === 'targetsAfter' && /缺少/.test(err.message))
        cleanupCase(c)
    })

    it('[S-R8] 守門: 對象須為 workDir 直屬之 inst<N>, 否則不動任何東西', function() {
        let c = mk()
        for (let [instRoot, workDir] of [
            [c.proj, c.work], //專案根
            [c.work, c.work], //工作目錄本身
            [c.dst, c.work], //非直屬
            [path.join(c.work, 'instX'), c.work], //名稱不符
            [c.inst, path.join(c.proj, 'tmp')], //workDir 不符
        ]) {
            assert.throws(() => removeE2eInstance({ instRoot, workDir, targets: [], log: () => {}, rmDir: () => assert.fail('不得刪除') }), (err) => err.step === 'guard')
        }
        assert.throws(() => removeE2eInstance({}), /instRoot 與 workDir 為必填/)
        assert.throws(() => removeE2eInstance({ instRoot: 1, workDir: c.work }), /instRoot 與 workDir 為必填/)
        assert.strict.equal(c.intact(), true)
        assert.strict.equal(fs.existsSync(c.dst), true)
        cleanupCase(c)
    })

    it('[S-R9] 實例不存在: 無動作, 回傳空', function() {
        let c = mk()
        let r = removeE2eInstance({ instRoot: path.join(c.work, 'inst9'), workDir: c.work, log: () => {} })
        assert.strict.deepEqual(r.links, [])
        cleanupCase(c)
    })

    it('[S-R10] 建立後多出之連結也只拆連結(目標之內容不動)', function() {
        let c = mk()
        let outer = path.join(c.base, 'outer')
        fs.mkdirSync(outer)
        fs.writeFileSync(path.join(outer, 'keep.txt'), 'k')
        fs.symlinkSync(outer, path.join(c.dst, 'extra'), 'junction')
        let r = removeE2eInstance({ instRoot: c.inst, workDir: c.work, targets: c.targets, log: () => {} })
        assert.strict.ok(r.links.includes('proj/extra'))
        assert.strict.equal(fs.readFileSync(path.join(outer, 'keep.txt'), 'utf8'), 'k')
        assert.strict.equal(fs.existsSync(c.inst), false)
        cleanupCase(c)
    })

})


describe('listDirLinks', function() {

    let fd = path.join(fdRoot, 'links')

    before(function() {
        fs.mkdirSync(path.join(fd, 'tree', 'a', 'b'), { recursive: true })
        fs.mkdirSync(path.join(fd, 'target', 'inner'), { recursive: true })
        fs.mkdirSync(path.join(fd, 'target2'), { recursive: true })
        //目標內也有連結: 不跟進時不可列出
        fs.symlinkSync(path.join(fd, 'target2'), path.join(fd, 'target', 'nested'), 'junction')
        fs.symlinkSync(path.join(fd, 'target'), path.join(fd, 'tree', 'a', 'j1'), 'junction')
        fs.symlinkSync(path.join(fd, 'target'), path.join(fd, 'tree', 'skipme'), 'junction')
    })

    after(function() {
        for (let p of [path.join(fd, 'tree', 'a', 'j1'), path.join(fd, 'tree', 'skipme'), path.join(fd, 'target', 'nested')]) {
            fs.rmSync(p, { force: true })
        }
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('[S-L1] 只列樹內之連結、不跟進到目標內部', function() {
        let r = listDirLinks(path.join(fd, 'tree'))
        assert.strict.deepEqual(r.map((v) => v.rel), ['a/j1', 'skipme'])
        assert.strict.ok(r.every((v) => path.isAbsolute(v.path)))
    })

    it('[S-L2] skip 可略過路徑', function() {
        let r = listDirLinks(path.join(fd, 'tree'), { skip: (rel) => rel === 'skipme' })
        assert.strict.deepEqual(r.map((v) => v.rel), ['a/j1'])
        let r2 = listDirLinks(path.join(fd, 'tree'), { skip: (rel) => rel === 'a' })
        assert.strict.deepEqual(r2.map((v) => v.rel), ['skipme'])
    })

    it('[S-L3] 根本身為連結時只回傳該連結', function() {
        let r = listDirLinks(path.join(fd, 'tree', 'skipme'))
        assert.strict.deepEqual(r.map((v) => v.rel), [''])
    })

    it('[S-L4] 枚舉失敗拋錯, 不視為沒有連結; 參數錯誤拋錯', function() {
        assert.throws(() => listDirLinks(path.join(fd, 'none')), /ENOENT/)
        assert.throws(() => listDirLinks(''), /root 須為非空字串/)
        assert.throws(() => listDirLinks(1), /root 須為非空字串/)
    })

})


describe('snapshotLinkTarget／diffLinkTarget', function() {

    let fd = path.join(fdRoot, 'snap')

    before(function() {
        fs.mkdirSync(path.join(fd, 'a', 'b'), { recursive: true })
        fs.writeFileSync(path.join(fd, 'a', 'b', 'f.txt'), '1')
        fs.writeFileSync(path.join(fd, 'g.txt'), '2')
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    it('[S-T1] depth 與 meta; 不存在之目錄 exists 為 false', function() {
        assert.strict.deepEqual(Object.keys(snapshotLinkTarget(fd, { depth: 1 }).entries).sort(), ['a', 'g.txt'])
        assert.strict.deepEqual(Object.keys(snapshotLinkTarget(fd).entries).sort(), ['a', 'a/b', 'a/b/f.txt', 'g.txt'])
        assert.strict.equal(snapshotLinkTarget(fd, { meta: false }).entries['g.txt'], 'f')
        assert.strict.equal(snapshotLinkTarget(path.join(fd, 'none')).exists, false)
    })

    it('[S-T2] diff 分出缺少、變動、多出; 目錄整個消失列 "."', function() {
        let a = { exists: true, entries: { x: '1:1', y: '1:1', z: 'd' } }
        let b = { exists: true, entries: { x: '2:2', z: 'd', w: '1:1' } }
        assert.strict.deepEqual(diffLinkTarget(a, b), { missing: ['y'], changed: ['x'], added: ['w'] })
        assert.strict.deepEqual(diffLinkTarget(a, { exists: false, entries: {} }).missing, ['.', 'x', 'y', 'z'])
    })

})
