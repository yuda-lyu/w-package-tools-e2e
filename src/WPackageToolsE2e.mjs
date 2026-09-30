import launchChromium from './launchChromium.mjs'
import launchChromiumCore from './launchChromiumCore.mjs'
import chromiumLaunchArgs from './chromiumLaunchArgs.mjs'
import launchBrowser from './launchBrowser.mjs'
import captureStable from './captureStable.mjs'
import captureStableWithBox from './captureStableWithBox.mjs'
import itemsUnionBox from './itemsUnionBox.mjs'
import inkRect, { INK_PAD } from './inkRect.mjs'
import waitAlertGone from './waitAlertGone.mjs'
import canvasInkRects from './canvasInkRects.mjs'
import composeBox, { BOX_PAD, BOX_STROKE } from './composeBox.mjs'
import stepShots from './stepShots.mjs'
import maskRegions from './maskRegions.mjs'
import overlayRegions from './overlayRegions.mjs'
import overlayImageAt from './overlayImageAt.mjs'
import cropRegion from './cropRegion.mjs'
import assertBaselineMatch from './assertBaselineMatch.mjs'
import typeIntoInput from './typeIntoInput.mjs'
import typeIntoNthInput from './typeIntoNthInput.mjs'
import waitUntilExist from './waitUntilExist.mjs'
import pollUntil from './pollUntil.mjs'
import collectDomText from './collectDomText.mjs'
import pageHasText from './pageHasText.mjs'
import assertTextSpec from './assertTextSpec.mjs'
import waitColResizeOverlay from './waitColResizeOverlay.mjs'
import waitDrawerReady from './waitDrawerReady.mjs'
import probeStuckTooltip from './probeStuckTooltip.mjs'
import resetAgGridScroll from './resetAgGridScroll.mjs'
import rowBoxSel from './rowBoxSel.mjs'
import gridContentBox from './gridContentBox.mjs'
import waitGridIdle from './waitGridIdle.mjs'
import getE2eMode from './getE2eMode.mjs'
import createBaselineGate from './createBaselineGate.mjs'
import findOrphanBaselines from './findOrphanBaselines.mjs'
import runBaselineCase from './runBaselineCase.mjs'
import normalizeShots from './normalizeShots.mjs'
import openCasePage from './openCasePage.mjs'
import createKnownDefect from './createKnownDefect.mjs'
import createServiceManager from './createServiceManager.mjs'
import registerCleanupHooks from './registerCleanupHooks.mjs'
import probeHttp from './probeHttp.mjs'
import createTempSettings from './createTempSettings.mjs'
import runIsolatedE2e from './runIsolatedE2e.mjs'
import killOwnTree from './killOwnTree.mjs'
import isChildAlive from './isChildAlive.mjs'
import waitChildExit from './waitChildExit.mjs'
import pidExists from './pidExists.mjs'
import sleepSync from './sleepSync.mjs'
import killPortListeners from './killPortListeners.mjs'
import listenerPids from './listenerPids.mjs'
import parseListenerPids from './parseListenerPids.mjs'
import snapshotBaselines from './snapshotBaselines.mjs'
import diffBaselineSnapshots from './diffBaselineSnapshots.mjs'
import compareImageDirs from './compareImageDirs.mjs'


// WPackageToolsE2e.mjs — e2e 測試與標準圖(pixel baseline)共用設施之共用入口
//
// 匯入 ./src 內其他全部模組, 以單一物件對外提供; 各模組亦可逐一以 w-package-tools-e2e/src/<模組>.mjs 深層引用.
// 引用本入口會一併載入全部模組與其依賴(playwright、sharp 等), 只用少數函數者宜深層引用.
// ./tools 之盤點 CLI 為可執行腳本(引用即執行並可能結束行程), 不在此匯入, 用法見各檔檔頭.


/**
 * e2e 測試與標準圖(pixel baseline)共用設施
 *
 * @returns {Object} 回傳物件，其內含截圖與影像(launchChromium、launchChromiumCore、chromiumLaunchArgs、launchBrowser、captureStable、captureStableWithBox、itemsUnionBox、inkRect、waitAlertGone、canvasInkRects、composeBox、stepShots、maskRegions、overlayRegions、overlayImageAt、cropRegion、assertBaselineMatch、typeIntoInput、typeIntoNthInput、waitUntilExist、pollUntil、collectDomText、pageHasText、assertTextSpec、waitColResizeOverlay、waitDrawerReady、probeStuckTooltip、resetAgGridScroll、rowBoxSel、gridContentBox、waitGridIdle)、產製與比對管線(getE2eMode、createBaselineGate、findOrphanBaselines、runBaselineCase、normalizeShots、openCasePage、createKnownDefect)、生命週期與行程(createServiceManager、registerCleanupHooks、probeHttp、createTempSettings、runIsolatedE2e、killOwnTree、isChildAlive、waitChildExit、pidExists、sleepSync、killPortListeners、listenerPids、parseListenerPids)、驗證工具(snapshotBaselines、diffBaselineSnapshots、compareImageDirs)，以及框幾何常數BOX_PAD、BOX_STROKE、INK_PAD
 * @example
 *
 * import wpte from 'w-package-tools-e2e/src/WPackageToolsE2e.mjs'
 *
 * let browser = await wpte.launchBrowser()
 * let page = await wpte.openCasePage(browser)
 * await page.goto('http://127.0.0.1:8080')
 * let buf = await wpte.captureStableWithBox(page, '#btn')
 * wpte.assertBaselineMatch(buf, './test/pics/demo/demo-eng-E2E-001-click-btn.png', 'demo-eng-E2E-001-click-btn')
 * await browser.close()
 *
 * 其餘詳見各模組範例
 *
 */
let WPackageToolsE2e = {

    //截圖與影像
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

    //產製與比對管線
    getE2eMode,
    createBaselineGate,
    findOrphanBaselines,
    runBaselineCase,
    normalizeShots,
    openCasePage,
    createKnownDefect,

    //生命週期與行程
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

    //驗證工具
    snapshotBaselines,
    diffBaselineSnapshots,
    compareImageDirs,

}


export default WPackageToolsE2e
