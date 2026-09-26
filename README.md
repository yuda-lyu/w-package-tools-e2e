# w-package-tools-e2e
A tool for build packages.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-package-tools-e2e.svg?style=flat)](https://npmjs.org/package/w-package-tools-e2e) 
[![license](https://img.shields.io/npm/l/w-package-tools-e2e.svg?style=flat)](https://npmjs.org/package/w-package-tools-e2e) 
[![npm download](https://img.shields.io/npm/dt/w-package-tools-e2e.svg)](https://npmjs.org/package/w-package-tools-e2e) 
[![npmdownload](https://img.shields.io/npm/dm/w-package-tools-e2e.svg)](https://npmjs.org/package/w-package-tools-e2e) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-package-tools-e2e.svg)](https://www.jsdelivr.com/package/npm/w-package-tools-e2e)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-package-tools-e2e/global.html#addVersion).

## Installation

### Using npm(ES6 module):
```alias

npm i w-package-tools-e2e

//launchChromium: 啟動Playwright之Chromium, 所需版本之瀏覽器不存在時先自動下載(不依賴安裝腳本)
import launchChromium from 'w-package-tools-e2e/src/launchChromium.mjs'
let browser = await launchChromium({ headless: true })

```