import fs from 'fs'
import path from 'path'
import process from 'process'
import launchBrowser from '../../src/launchBrowser.mjs'


//probeWDrawerDom: 升級w-component-vue後複驗waitDrawerReady之預設選擇器(Gitea #35)
//  唯讀載入w-component-vue之dist(umd)與其node_modules/vue, 於真Chromium掛載帶state屬性之各元件, 傾印根節點之實際屬性,
//  並斷言預設選擇器只命中WDrawer根節點(不命中WDialog、浮層、WListExpandItem、WGroupTags、WGroupDragdrop); 不符則離開碼1
//  用法: node test/tools/probeWDrawerDom.mjs <w-component-vue專案根目錄>   (或設環境變數W_COMPONENT_VUE_DIR)
//  waitDrawerReady之預設選擇器依元件內部屬性(changeDrawerWidth), 元件改版或改寫時此處會失敗, 屆時改src/waitDrawerReady.mjs之預設值與JSDoc依據


let dir = process.argv[2] || process.env.W_COMPONENT_VUE_DIR
if (!dir) {
    console.error('用法: node test/tools/probeWDrawerDom.mjs <w-component-vue專案根目錄>')
    process.exit(2)
}
dir = path.resolve(dir)
let vueJs = fs.readFileSync(path.join(dir, 'node_modules', 'vue', 'dist', 'vue.js'), 'utf8')
let umdJs = fs.readFileSync(path.join(dir, 'dist', 'w-component-vue.umd.js'), 'utf8')
let ver = (umdJs.match(/w-component-vue v([\d.]+)/) || [])[1] || '?'

//DEFAULT_SELECTOR須與src/waitDrawerReady.mjs之預設值相同
let DEFAULT_SELECTOR = '[state][changedrawerwidth]'

let code = 0
let browser = await launchBrowser()
try {
    let ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    let page = await ctx.newPage()
    let errs = []
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') {
            errs.push(m.text())
        }
    })
    page.on('pageerror', (e) => {
        errs.push(`pageerror ${e.message}`)
    })
    await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;"></body></html>')
    await page.addScriptTag({ content: vueJs })
    await page.addScriptTag({ content: umdJs })
    let rows = await page.evaluate(async (sel) => {
        window.Vue.use(window['w-component-vue'])
        let el = document.createElement('div')
        document.body.appendChild(el)
        new window.Vue({
            data: { dr: false, dl: false, pp: false, ex: false, tags: ['a', 'b'], dd: ['x', 'y'] },
            template: `
            <div style="padding:10px; width:900px; height:600px;">
                <w-drawer v-model="dr" style="width:800px; height:300px;">
                    <template v-slot:content><div>content</div></template>
                    <template v-slot:drawer><div>drawer</div></template>
                </w-drawer>
                <w-dialog :show.sync="dl" title="T"><template v-slot:content><div>dlg</div></template></w-dialog>
                <w-tooltip><template v-slot:trigger><button>tip</button></template><template v-slot:content><div>tip</div></template></w-tooltip>
                <w-popup v-model="pp"><template v-slot:trigger><button>pop</button></template><template v-slot:content><div>pop</div></template></w-popup>
                <w-list-expand-item text="Item" :active.sync="ex"><template v-slot:content><div>exp</div></template></w-list-expand-item>
                <w-group-tags v-model="tags" :editable="false"></w-group-tags>
                <w-group-dragdrop v-model="dd"><template v-slot="props"><span>{{props.item}}</span></template></w-group-dragdrop>
            </div>`,
        }).$mount(el)
        await new Promise((resolve) => setTimeout(resolve, 800))
        let hit = new Set(document.querySelectorAll(sel))
        return Array.from(document.querySelectorAll('[state]')).map((e) => {
            let vm = e.__vue__
            return {
                comp: vm && vm.$options ? (vm.$options.name || vm.$options._componentTag || '') : (e.classList.contains('WPopperFix') ? '(浮層.WPopperFix)' : '?'),
                state: e.getAttribute('state'),
                attrs: Array.from(e.attributes).map((a) => a.name).filter((n) => !/^(data-v-|ev-resize|style$|id$)/.test(n)).join(' '),
                hit: hit.has(e),
            }
        })
    }, DEFAULT_SELECTOR)
    console.log(`w-component-vue ${ver}, 預設選擇器 ${DEFAULT_SELECTOR}`)
    for (let r of rows) {
        console.log(`${r.hit ? '命中' : '    '} ${r.comp.padEnd(20)} state=${r.state.padEnd(10)} 屬性: ${r.attrs}`)
    }
    let hitComps = rows.filter((r) => r.hit).map((r) => r.comp)
    if (hitComps.length !== 1 || hitComps[0] !== 'w-drawer') {
        console.error(`失敗: 預設選擇器應只命中1個w-drawer, 實際命中 [${hitComps.join(', ')}]`)
        code = 1
    }
    if (errs.length > 0) {
        console.error(`頁面有console錯誤或警告: ${errs.join(' | ').slice(0, 500)}`)
        code = 1
    }
}
finally {
    await browser.close()
}
process.exit(code)
