import fs from 'fs'
import assert from 'assert'
import { fileURLToPath } from 'url'
import wpte from '../src/WPackageToolsE2e.mjs'
import launchChromium from '../src/launchChromium.mjs'
import launchChromiumCore from '../src/launchChromiumCore.mjs'
import chromiumLaunchArgs from '../src/chromiumLaunchArgs.mjs'
import launchBrowser from '../src/launchBrowser.mjs'
import captureStable from '../src/captureStable.mjs'
import captureStableWithBox from '../src/captureStableWithBox.mjs'
import itemsUnionBox from '../src/itemsUnionBox.mjs'
import inkRect, { INK_PAD } from '../src/inkRect.mjs'
import waitAlertGone from '../src/waitAlertGone.mjs'
import canvasInkRects from '../src/canvasInkRects.mjs'
import composeBox, { BOX_PAD, BOX_STROKE } from '../src/composeBox.mjs'
import stepShots from '../src/stepShots.mjs'
import maskRegions from '../src/maskRegions.mjs'
import overlayRegions from '../src/overlayRegions.mjs'
import overlayImageAt from '../src/overlayImageAt.mjs'
import cropRegion from '../src/cropRegion.mjs'
import assertBaselineMatch from '../src/assertBaselineMatch.mjs'
import typeIntoInput from '../src/typeIntoInput.mjs'
import typeIntoNthInput from '../src/typeIntoNthInput.mjs'
import waitUntilExist from '../src/waitUntilExist.mjs'
import pollUntil from '../src/pollUntil.mjs'
import collectDomText from '../src/collectDomText.mjs'
import pageHasText from '../src/pageHasText.mjs'
import assertTextSpec from '../src/assertTextSpec.mjs'
import waitColResizeOverlay from '../src/waitColResizeOverlay.mjs'
import waitDrawerReady from '../src/waitDrawerReady.mjs'
import probeStuckTooltip from '../src/probeStuckTooltip.mjs'
import resetAgGridScroll from '../src/resetAgGridScroll.mjs'
import rowBoxSel from '../src/rowBoxSel.mjs'
import gridContentBox from '../src/gridContentBox.mjs'
import waitGridIdle from '../src/waitGridIdle.mjs'
import getE2eMode from '../src/getE2eMode.mjs'
import createBaselineGate from '../src/createBaselineGate.mjs'
import findOrphanBaselines from '../src/findOrphanBaselines.mjs'
import runBaselineCase from '../src/runBaselineCase.mjs'
import normalizeShots from '../src/normalizeShots.mjs'
import openCasePage from '../src/openCasePage.mjs'
import createKnownDefect from '../src/createKnownDefect.mjs'
import createServiceManager from '../src/createServiceManager.mjs'
import registerCleanupHooks from '../src/registerCleanupHooks.mjs'
import probeHttp from '../src/probeHttp.mjs'
import createTempSettings from '../src/createTempSettings.mjs'
import runIsolatedE2e from '../src/runIsolatedE2e.mjs'
import killOwnTree from '../src/killOwnTree.mjs'
import isChildAlive from '../src/isChildAlive.mjs'
import waitChildExit from '../src/waitChildExit.mjs'
import pidExists from '../src/pidExists.mjs'
import sleepSync from '../src/sleepSync.mjs'
import killPortListeners from '../src/killPortListeners.mjs'
import listenerPids from '../src/listenerPids.mjs'
import parseListenerPids from '../src/parseListenerPids.mjs'
import snapshotBaselines from '../src/snapshotBaselines.mjs'
import diffBaselineSnapshots from '../src/diffBaselineSnapshots.mjs'
import compareImageDirs from '../src/compareImageDirs.mjs'


//共用入口之單元測試: 鍵名與順序、型別、即各模組之匯出、src 內其他模組皆已登錄、可經入口呼叫


//src 目錄(模組自身位置, 全域 §11.1 場景 B)
let fdSrc = fileURLToPath(new URL('../src/', import.meta.url))


describe('WPackageToolsE2e', function() {

    it('對外提供全部模組與框幾何常數(依截圖與影像、產製與比對管線、生命週期與行程、驗證工具排列)', function() {
        let r = Object.keys(wpte)
        let rr = [
            'launchChromium',
            'launchChromiumCore',
            'chromiumLaunchArgs',
            'launchBrowser',
            'captureStable',
            'captureStableWithBox',
            'itemsUnionBox',
            'inkRect',
            'INK_PAD',
            'waitAlertGone',
            'canvasInkRects',
            'composeBox',
            'BOX_PAD',
            'BOX_STROKE',
            'stepShots',
            'maskRegions',
            'overlayRegions',
            'overlayImageAt',
            'cropRegion',
            'assertBaselineMatch',
            'typeIntoInput',
            'typeIntoNthInput',
            'waitUntilExist',
            'pollUntil',
            'collectDomText',
            'pageHasText',
            'assertTextSpec',
            'waitColResizeOverlay',
            'waitDrawerReady',
            'probeStuckTooltip',
            'resetAgGridScroll',
            'rowBoxSel',
            'gridContentBox',
            'waitGridIdle',
            'getE2eMode',
            'createBaselineGate',
            'findOrphanBaselines',
            'runBaselineCase',
            'normalizeShots',
            'openCasePage',
            'createKnownDefect',
            'createServiceManager',
            'registerCleanupHooks',
            'probeHttp',
            'createTempSettings',
            'runIsolatedE2e',
            'killOwnTree',
            'isChildAlive',
            'waitChildExit',
            'pidExists',
            'sleepSync',
            'killPortListeners',
            'listenerPids',
            'parseListenerPids',
            'snapshotBaselines',
            'diffBaselineSnapshots',
            'compareImageDirs',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('src 內其他模組皆已匯入(新增模組未登錄於入口即失敗)', function() {
        let r = fs.readdirSync(fdSrc)
            .filter((f) => f.endsWith('.mjs') && f !== 'WPackageToolsE2e.mjs')
            .map((f) => f.replace(/\.mjs$/, ''))
            .filter((k) => !(k in wpte))
        let rr = []
        assert.strict.deepEqual(r, rr)
    })

    it('各鍵值型別正確(chromiumLaunchArgs為凍結陣列, 三個框幾何常數為數字, 其餘為函數)', function() {
        let r = Object.keys(wpte).filter((k) => typeof wpte[k] !== 'function').map((k) => [k, Array.isArray(wpte[k]) ? 'array' : typeof wpte[k]])
        let rr = [['chromiumLaunchArgs', 'array'], ['INK_PAD', 'number'], ['BOX_PAD', 'number'], ['BOX_STROKE', 'number']]
        assert.strict.deepEqual(r, rr)
        assert.strict.equal(Object.isFrozen(wpte.chromiumLaunchArgs), true)
    })

    it('各鍵值即為對應模組之匯出', function() {
        let mods = {
            launchChromium,
            launchChromiumCore,
            chromiumLaunchArgs,
            launchBrowser,
            captureStable,
            captureStableWithBox,
            itemsUnionBox,
            inkRect,
            INK_PAD,
            waitAlertGone,
            canvasInkRects,
            composeBox,
            BOX_PAD,
            BOX_STROKE,
            stepShots,
            maskRegions,
            overlayRegions,
            overlayImageAt,
            cropRegion,
            assertBaselineMatch,
            typeIntoInput,
            typeIntoNthInput,
            waitUntilExist,
            pollUntil,
            collectDomText,
            pageHasText,
            assertTextSpec,
            waitColResizeOverlay,
            waitDrawerReady,
            probeStuckTooltip,
            resetAgGridScroll,
            rowBoxSel,
            gridContentBox,
            waitGridIdle,
            getE2eMode,
            createBaselineGate,
            findOrphanBaselines,
            runBaselineCase,
            normalizeShots,
            openCasePage,
            createKnownDefect,
            createServiceManager,
            registerCleanupHooks,
            probeHttp,
            createTempSettings,
            runIsolatedE2e,
            killOwnTree,
            isChildAlive,
            waitChildExit,
            pidExists,
            sleepSync,
            killPortListeners,
            listenerPids,
            parseListenerPids,
            snapshotBaselines,
            diffBaselineSnapshots,
            compareImageDirs,
        }
        let r = Object.keys(mods).filter((k) => wpte[k] !== mods[k])
        let rr = []
        assert.strict.deepEqual(r, rr)
        assert.strict.deepEqual([wpte.BOX_PAD, wpte.BOX_STROKE, wpte.INK_PAD], [6, 5, 4])
    })

    it('可由WPackageToolsE2e呼叫各函數(純函數抽樣)', function() {
        let buf = Buffer.from('x')
        let r = [
            wpte.rowBoxSel(3),
            wpte.normalizeShots(buf, 'E2E-001-a').map((s) => s.key),
            wpte.inkRect({ x: 10, y: 20, width: 30, height: 40 }),
            wpte.parseListenerPids('  TCP    0.0.0.0:11007   0.0.0.0:0   LISTENING   1234', 11007),
            wpte.getE2eMode({ argv: ['node', 'x.mjs', '--baseline'], env: {} }),
            wpte.createKnownDefect('徵狀', { ref: 'spec' }).knownDefect,
        ]
        let rr = [
            ['.ag-pinned-left-cols-container .ag-row[row-index="3"]', '.ag-center-cols-container .ag-row[row-index="3"]'],
            ['E2E-001-a'],
            { x: 6, y: 16, width: 38, height: 48 },
            ['1234'],
            { regen: true, diag: false, strictCapture: false },
            true,
        ]
        assert.strict.deepEqual(r, rr)
    })

})
