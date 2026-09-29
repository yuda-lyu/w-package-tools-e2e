import assert from 'assert'
import rowBoxSel from '../src/rowBoxSel.mjs'


//技術棧 adapter 之單元測試


describe('rowBoxSel', function() {

    it('預設順序為 pinned-left 在前(w-web-sso 手寫之順序), 可帶 scope', function() {
        assert.strict.deepStrictEqual(rowBoxSel(3), [
            '.ag-pinned-left-cols-container .ag-row[row-index="3"]',
            '.ag-center-cols-container .ag-row[row-index="3"]',
        ])
        assert.strict.deepStrictEqual(rowBoxSel(0, { scope: '#dlg' })[0], '#dlg .ag-pinned-left-cols-container .ag-row[row-index="0"]')
    })

    it('order 可重現 w-web-perm / w-web-task 之 center 在前; 無效元素拋錯', function() {
        assert.strict.deepStrictEqual(rowBoxSel(1, { order: ['center', 'pinned-left'] }), [
            '.ag-center-cols-container .ag-row[row-index="1"]',
            '.ag-pinned-left-cols-container .ag-row[row-index="1"]',
        ])
        assert.throws(() => rowBoxSel(1, { order: ['right'] }), /order/)
    })

})
