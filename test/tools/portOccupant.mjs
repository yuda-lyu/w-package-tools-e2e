//埠之實機測試共用: 由測試自建之占用者(獨立行程、真實監聽)與回驗
import path from 'path'
import assert from 'assert'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import pidExists from '../../src/pidExists.mjs'


let fpSrv = path.resolve(fileURLToPath(new URL('./portFixtureSrv.mjs', import.meta.url)))
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//起占用者並等到它自己回應(以 PID 確認, 不是別人); spawned 為呼叫端之清理清單; opt.ipv6Only 為 true 時綁 { host: '::', ipv6Only: true }
async function spawnOccupant(port, host = '127.0.0.1', spawned = [], opt = {}) {
    let args = [fpSrv, 'occupant', String(port), host, ...(opt.ipv6Only === true ? ['v6only'] : [])]
    let child = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true })
    spawned.push(child)
    let url = `http://${host.includes(':') ? `[${host === '::' ? '::1' : host}]` : (host === '0.0.0.0' ? '127.0.0.1' : host)}:${port}/`
    let t0 = Date.now()
    while (Date.now() - t0 < 30000) {
        try {
            let j = await (await fetch(url)).json()
            if (j.pid === child.pid) {
                return { child, port, url }
            }
        }
        catch (err) {}
        if (child.exitCode !== null) {
            throw new Error(`占用者無法綁定 ${host}:${port}`)
        }
        await sleep(50)
    }
    throw new Error('占用者未就緒')
}


//占用者毫髮無傷: 同一 PID 仍存活且仍在該埠回應
async function assertOccupantIntact(o) {
    assert.strict.equal(o.child.exitCode, null, '占用者不得結束')
    assert.strict.equal(pidExists(o.child.pid), true)
    let j = await (await fetch(o.url)).json()
    assert.strict.deepEqual([j.role, j.pid, j.port], ['occupant', o.child.pid, o.port])
}


function stopChild(child) {
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
    }
}


export {
    fpSrv,
    spawnOccupant,
    assertOccupantIntact,
    stopChild
}
