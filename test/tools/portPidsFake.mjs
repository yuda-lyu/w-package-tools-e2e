//listenerPids/killPortListeners之單元測試共用: netstat/PowerShell/lsof之固定輸出與spawnSync形之注入替身
//  替身形狀同wsemi execProcessPortPidsSync之opt.exec: (prog, args, { src, timeout, maxBuffer }) => { status, stdout, error }
//  PowerShell輸出為wsemi內部格式(標記行與`R <本地埠> <遠端位址> <遠端埠> <PID>`列), 取自wsemi test/tools/portPidsKit.mjs之ps(); wsemi改版時僅此處同步


//psOut, 組PowerShell(Get-NetTCPConnection)之輸出; rows為[本地埠, 遠端位址, 遠端埠, PID]
function psOut(rows) {
    return ['WSEMI-PORTPIDS-BEGIN', ...rows.map((r) => `R ${r.join(' ')}`), 'WSEMI-PORTPIDS-END'].join('\r\n') + '\r\n'
}

//ok, 與spawnSync同形之成功結果(status預設0)
function ok(stdout, status = 0) {
    return { status, stdout, error: null }
}

//err, 與spawnSync同形之無法啟動/逾時結果(code為'ENOENT'、'ETIMEDOUT'等)
function err(code) {
    let e = new Error(`spawn x ${code}`)
    e.code = code
    return { status: null, stdout: '', error: e }
}

//THROW, 注入之執行函數拋錯之標記
let THROW = { throw: true }

//fakeExec, 注入之同步執行函數: outs為{ netstat, powershell, lsof, taskkill, kill }之結果(THROW為拋錯, 未列之src拋錯以免被靜默略過), calls記錄各次呼叫
function fakeExec(outs, calls) {
    return (prog, args, o) => {
        calls.push({ src: o.src, prog, args, timeout: o.timeout, maxBuffer: o.maxBuffer })
        let r = outs[o.src]
        if (r === undefined) {
            throw new Error(`unexpected src ${o.src}`)
        }
        if (r === THROW) {
            throw new Error(`boom ${o.src}`)
        }
        return r
    }
}


export {
    psOut,
    ok,
    err,
    THROW,
    fakeExec
}
