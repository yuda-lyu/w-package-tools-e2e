import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import pidExists from './pidExists.mjs'


//建鎖失敗之暫時性占用錯誤(Windows 上刪除或建立進行中)
let codesBusy = ['EPERM', 'EBUSY', 'EACCES']

//建鎖連續被拒(鎖資料夾不在而被拒，多為權限不足等永久性錯誤)達此次數即拋出，不空轉
let DENIED_MAX = 100

let rm = (fp) => {
    fs.rmSync(fp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}


/**
 * 跨行程之資料夾鎖：以mkdir之原子性互斥，持有者以owner.json(pid、token)與心跳(owner.json之修改時間)表明存活
 *
 * 供createCdnLocal保證「多個行程(例如mocha --parallel之多個worker)同時首次取得時，只由一個行程下載」，亦可獨立使用。
 * 本函數不等候也不輪詢(等候迴圈由呼叫端依自己之時限寫)，只提供四個原語：
 * tryLock(建鎖，成功即開始心跳)、release(核對token後才刪鎖)、judge(判定鎖是否殘留)、reclaim(原子回收殘留鎖)。
 *
 * 心跳：每次先核對owner.json之token仍是自己(被他行程接手後停止，不刷新他人之鎖；鎖被搬走或刪除亦停止)，再更新owner.json與鎖資料夾之修改時間。
 * 殘留判定：持有者行程已不存在(pidExists為false)，或心跳逾staleMs；owner.json在但無法解析(寫到一半、暫時讀不到)者，仍以owner.json之修改時間判定而不取其中之pid與token(免把長時間持有之活鎖誤判為殘留)；owner.json不在(剛建立而尚未寫入)者，改以鎖資料夾之修改時間判定。
 * 回收：先以renameSync(原子，同一個鎖資料夾只有一個回收者成功)搬成墓碑資料夾再刪除；改名後核對搬走者之token即判定當下之持有者，
 * 不符(判定與改名之間，他人已回收並建立新鎖，搬走的是他人之新鎖)則盡力改回；已有更新之鎖而改回失敗者，只能刪除所搬走者
 * (判定與改名之間仍有極小之空窗，其後果至多為持有新鎖者失去鎖而重複下載，不會損及已校驗之內容)。
 * 持有者釋放時核對token，不刪他人(已接手者)之鎖；心跳計時器unref，不阻擋行程結束。
 * 建鎖遇EPERM、EBUSY、EACCES(Windows刪除或建立進行中)而鎖資料夾仍在者視為占用(回傳false)；鎖資料夾不在而連續被拒100次者拋出原錯誤(中間遇鎖資料夾存在即重新計數)。
 * 建了鎖資料夾卻寫不出owner.json者不遺留無主之鎖(他行程須等殘留判定時長才能回收)，刪除後回傳false。
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.lockDir 輸入鎖資料夾路徑字串(其上層資料夾須已存在)
 * @param {Number} [opt.staleMs=150000] 輸入殘留判定時長毫秒數(正數)，非預期之輸入視為未給，預設150000；心跳間隔為其1/3(10毫秒至2秒)，故持有者之心跳必在被判殘留前更新
 * @param {Function} [opt.isAlive] 輸入判斷pid是否存在之函數，格式為(pid)=>Boolean，預設pidExists
 * @param {Function} [opt.now=Date.now] 輸入取得現在時刻毫秒數之函數，預設Date.now
 * @returns {Object} 回傳物件{tryLock,release,judge,reclaim,lockDir,ownerFp}；tryLock()回傳是否取得；release()無回傳；judge()回傳null(非殘留或鎖已消失)或{token}(判定當下之持有者token，無owner檔者為空字串)；reclaim(judged)回傳是否由本呼叫回收成功
 * @example
 *
 * import createDirLock from 'w-package-tools-e2e/src/createDirLock.mjs'
 *
 * let lock = createDirLock({ lockDir: './tmp/cache/.lock', staleMs: 30000 })
 * if (lock.tryLock()) {
 *     try {
 *         //...只有一個行程會進到這裡...
 *     }
 *     finally {
 *         lock.release()
 *     }
 * }
 * else {
 *     let judged = lock.judge()
 *     if (judged) {
 *         lock.reclaim(judged)
 *     }
 * }
 *
 */
function createDirLock(opt) {
    let lockDir = opt && opt.lockDir
    if (typeof lockDir !== 'string' || lockDir === '') {
        throw new Error('createDirLock: opt.lockDir 須為非空字串')
    }
    let staleMs = opt.staleMs
    if (!(typeof staleMs === 'number' && Number.isFinite(staleMs) && staleMs > 0)) {
        staleMs = 150000
    }
    let isAlive = typeof opt.isAlive === 'function' ? opt.isAlive : (pid) => pidExists(pid)
    let now = typeof opt.now === 'function' ? opt.now : Date.now
    let ownerFp = path.join(lockDir, 'owner.json')
    let token = ''
    let beat = null
    let denied = 0

    let stopBeat = () => {
        if (beat) {
            clearInterval(beat)
        }
        beat = null
    }

    let tryLock = () => {
        try {
            fs.mkdirSync(lockDir)
        }
        catch (err) {
            if (err && err.code === 'EEXIST') {
                denied = 0 //鎖資料夾存在(被他人持有)：「鎖資料夾不在而被拒」之連續計數中斷
                return false
            }
            if (err && codesBusy.includes(err.code)) {
                if (fs.existsSync(lockDir)) {
                    return false
                }
                denied++
                if (denied >= DENIED_MAX) {
                    throw err
                }
                return false
            }
            throw err
        }
        denied = 0
        token = crypto.randomBytes(8).toString('hex')
        try {
            fs.writeFileSync(ownerFp, JSON.stringify({ pid: process.pid, token, t: now() }))
        }
        catch (err) {
            try {
                rm(lockDir)
            }
            catch (e) {}
            return false
        }
        stopBeat() //本實例先前之鎖若已被移除(例如被他行程視為殘留而回收)後再取得，先前之心跳不得留下
        beat = setInterval(() => {
            try {

                //每次心跳先核對 owner 仍是自己(被他行程接手後不再刷新他人之鎖)，再更新 owner.json 與鎖資料夾之修改時間(後者供 owner.json 暫時讀不到時之判定)
                let o = JSON.parse(fs.readFileSync(ownerFp, 'utf8'))
                if (o.token !== token) {
                    stopBeat()
                    return
                }
                let d = new Date()
                fs.utimesSync(ownerFp, d, d)
                fs.utimesSync(lockDir, d, d)
            }
            catch (err) {
                if (err && err.code === 'ENOENT') {
                    stopBeat() //鎖已被搬走或刪除
                }
            }
        }, Math.max(10, Math.min(2000, Math.floor(staleMs / 3))))
        beat.unref()
        return true
    }

    let release = () => {
        stopBeat()
        try {
            let o = JSON.parse(fs.readFileSync(ownerFp, 'utf8'))
            if (o.token !== token) {
                return //已被視為殘留而由他行程接手，不刪他人之鎖
            }
        }
        catch (err) {
            return
        }
        try {
            rm(lockDir)
        }
        catch (err) {} //刪不掉者留待殘留判定(行程結束或心跳逾時)，不遮蔽呼叫端自己之結果
    }

    let judge = () => {
        try {
            let t
            let pid = 0
            let tok = ''
            try {
                let o = JSON.parse(fs.readFileSync(ownerFp, 'utf8'))
                pid = Number.isSafeInteger(o.pid) && o.pid > 0 ? o.pid : 0
                tok = typeof o.token === 'string' ? o.token : ''
            }
            catch (err) {} //owner尚未寫入、寫到一半或暫時讀不到：不取其中之pid與token
            try {
                t = fs.statSync(ownerFp).mtimeMs //owner檔在(含無法解析者)即以其修改時間(心跳)判定，免把長時間持有之活鎖誤判為殘留
            }
            catch (err) {
                t = fs.statSync(lockDir).mtimeMs //owner檔不在(剛建立而尚未寫入)：以鎖資料夾之修改時間判定；鎖已消失時拋錯，由外層回傳null
            }
            if ((pid && !isAlive(pid)) || now() - t > staleMs) {
                return { token: tok }
            }
            return null
        }
        catch (err) {
            return null //鎖已消失，由呼叫端之迴圈重試取鎖
        }
    }

    let reclaim = (judged) => {
        let tomb = `${lockDir}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
        try {
            fs.renameSync(lockDir, tomb)
        }
        catch (err) {
            return false //他人已回收或釋放，或Windows上暫時被占用：由呼叫端之迴圈重試
        }
        let tok = ''
        try {
            let o = JSON.parse(fs.readFileSync(path.join(tomb, 'owner.json'), 'utf8'))
            tok = typeof o.token === 'string' ? o.token : ''
        }
        catch (err) {}
        let want = judged && typeof judged.token === 'string' ? judged.token : ''
        if (tok !== want) {
            try {
                fs.renameSync(tomb, lockDir)
                return false
            }
            catch (err) {} //已有更新之鎖：放棄改回，刪除所搬走者
        }
        try {
            rm(tomb)
        }
        catch (err) {}
        return true
    }

    return { tryLock, release, judge, reclaim, lockDir, ownerFp }
}


export default createDirLock
