# Changelog

## [0.4.0](https://github.com/shubhamtaywade82/pine-ts/compare/v0.3.0...v0.4.0) (2026-11-03)


### Features

* **ta:** add Pine v6 ALMA primitive, weight caching, and multi-ALMA analysis ([8f41e06](https://github.com/shubhamtaywade82/pine-ts/commit/8f41e06717a45873bbeda36d7ac659f45972040f))

## [0.3.0](https://github.com/shubhamtaywade82/pine-ts/compare/v0.2.1...v0.3.0) (2026-11-02)


### Features

* **request:** 40-call request.*() call-site quota (TradingView Ultimate parity) ([5e2bf8a](https://github.com/shubhamtaywade82/pine-ts/commit/5e2bf8a8f916bb0f7615974cce9d5edfd675a4d7))


### Bug Fixes

* **script:** roll back alert events on realtime ticks and drop stale pass-1 alerts in security runs ([5ecf48c](https://github.com/shubhamtaywade82/pine-ts/commit/5ecf48c27b2ff173c412da31bad8ac7f53956e6c))

## [0.2.1](https://github.com/shubhamtaywade82/pine-ts/compare/v0.2.0...v0.2.1) (2026-10-28)


### Bug Fixes

* **ci:** use npm publish for provenance and auth token compatibility in publish workflow ([4ff8d8e](https://github.com/shubhamtaywade82/pine-ts/commit/4ff8d8e767df250a06676f14445b245133d3e4a4))

## [0.2.0](https://github.com/shubhamtaywade82/pine-ts/compare/v0.1.1...v0.2.0) (2026-10-27)


### Features

* add new technical indicators including ATR, CCI, DMI, HMA, KC, MFI, SAR, Supertrend, VWAP, and others ([443f35e](https://github.com/shubhamtaywade82/pine-ts/commit/443f35e118cc722fefe525eb4d9dafb018561fe4))
* enhance drawing capabilities and introduce higher-timeframe security evaluation ([d6d28cd](https://github.com/shubhamtaywade82/pine-ts/commit/d6d28cdade06c445d14d9f9e3531be0ebef87d90))
* enhance drawing functions to support text labels for order blocks and fair value gaps ([f1d4303](https://github.com/shubhamtaywade82/pine-ts/commit/f1d4303ffa6f7071c787a4491c1542a45864b707))
* enhance strategy engine with trade excursion tracking and margin calculations ([14cd102](https://github.com/shubhamtaywade82/pine-ts/commit/14cd102b5150674e7277278bedce163a73aef4b6))
* **script:** add alert and alertcondition to ScriptApi and record in ScriptOutput ([c23075e](https://github.com/shubhamtaywade82/pine-ts/commit/c23075ee924130bf1ac2e61df70e3131ce86181f))
* **script:** live() runs only changed bars on a live chart ([3ab64ae](https://github.com/shubhamtaywade82/pine-ts/commit/3ab64ae28771c20ce8383e3cf1bc9d8197061ed2))
* **security:** add higher timeframe bar loader for multi-timeframe scripts ([7d60dac](https://github.com/shubhamtaywade82/pine-ts/commit/7d60dac45c14cfc00e5a57561fad68adf7a6046e))
* **shapes:** add LabelSize and size option to LabelShape ([ea3d9ec](https://github.com/shubhamtaywade82/pine-ts/commit/ea3d9ec2d74515e854f0b072fb511bec20af219d))
* **smc:** introduce Smart Money Concepts structure detection ([23b2ca7](https://github.com/shubhamtaywade82/pine-ts/commit/23b2ca70d3a896dc533e5ab6e3ce16eb42eae29c))


### Bug Fixes

* **ci:** internalize evaluateOnBars for knip and ignore changelog in prettier ([bffdb03](https://github.com/shubhamtaywade82/pine-ts/commit/bffdb035800e7cce7acf73e97253e3286c7b5a65))
