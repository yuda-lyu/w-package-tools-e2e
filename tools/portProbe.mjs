//以實際綁定檢查多個埠是否可用, 結果以 JSON 陣列印到 stdout(元素同 checkPortFree 之回傳)。
//reserveE2ePorts 為同步函數(使用端於模組最上層呼叫, 其後之常數即依實際埠組成), 綁定只能非同步, 故以子行程執行。
//  node tools/portProbe.mjs 8080 11007
import checkPortFree from '../src/checkPortFree.mjs'

let ports = process.argv.slice(2).map(Number)
let rs = []
for (let port of ports) {
    rs.push(await checkPortFree(port))
}
process.stdout.write(JSON.stringify(rs))
