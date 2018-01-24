# Changelog

All notable changes to parcel will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and parcel adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2018-01-23

### Added

* SourceMap support [Details](https://github.com/parcel-bundler/parcel/commit/5c5d5f8af634c0e0aa8e8a3542892febe7c27e85)
* Custom bundleloader and wasm support [Details](https://github.com/parcel-bundler/parcel/commit/244f274f710048682505351fbed777ac7bc49406)
* Rust support [Details](https://github.com/parcel-bundler/parcel/commit/a429c52bb4e53effe586d677d53704a78c8d302b)
* Ability to set HMR port [Details](https://github.com/parcel-bundler/parcel/commit/065a49e8f673922e514c5279d79df74f052a1558)
* Support .env files [Details](https://github.com/parcel-bundler/parcel/commit/50de97fb1239b7079f36c3897fe0c0c5f2e39070)
* Hotreload css requires in html [Details](https://github.com/parcel-bundler/parcel/commit/fb3f9d7a5e120766dd3656ce00b4bb07e76d6af1)
* Minify JSON [Details](https://github.com/parcel-bundler/parcel/commit/c858843bb0e72c6ad46a2349b36843e00b86ea76)
* Ability to set HMR hostname [Details](https://github.com/parcel-bundler/parcel/commit/b56b2a9f3c3ff6db2dd27a086b409a8d4af6f2bd)
* Ability to specify amount of workers using `PARCEL_WORKERS` environment variable [Details](https://github.com/parcel-bundler/parcel/commit/0a2f554080db7f7b3f077e07ac62ade9170d1372)
* Warning emoji [Details](https://github.com/parcel-bundler/parcel/commit/25cf21709a0829131311281cb369d792cf666aa3)

### Fixed

* Virtualpaths, throw file not found error [Details](https://github.com/parcel-bundler/parcel/commit/e09575d495d2ac5282671eab88b827191eee7fa7)
* Transform HTML prior to collecting dependencies [Details](https://github.com/parcel-bundler/parcel/commit/2fbba629eaa83d7de5ccba79e01faa1187393f16)
* Find a[href] dependencies when attrs precede it [Details](https://github.com/parcel-bundler/parcel/commit/39c5cfe377be603b16561f914cb9a07c7e5fdd6c)
* Resolve URI-encoded assets [Details](https://github.com/parcel-bundler/parcel/commit/9770acfb7576572715dd672195180d5fec8156a9)
* Public-url not an os path [Details](https://github.com/parcel-bundler/parcel/commit/a852dd2cd0dc856121ebc2e6cbc2589525a3d435)
* Invalidate cache when parent dependencies change [Details](https://github.com/parcel-bundler/parcel/commit/b8e897341e942b04967a1d44f462375292d5b990)
* Invalidate cache on config change [Details](https://github.com/parcel-bundler/parcel/commit/6c3d34f2215a46dd7845193a6f4036930eaddf48)
* Circular bundles [Details](https://github.com/parcel-bundler/parcel/commit/dd26db34fb70b3e40826bf3c4878172eb60afe91)
* Possibly ignore fs using browser-resolve config [Details](https://github.com/parcel-bundler/parcel/commit/bd9fd9f6193c3f18efa03f897a33906869808b96)
* Do not use global window inside hmr, fixes web worker issues [Details](https://github.com/parcel-bundler/parcel/commit/6962a9a96cdedafbf27715bc74b93e6c8ad7eb19)
* Improved worker startup times [Details](https://github.com/parcel-bundler/parcel/commit/072d799d48bb3639c628687937f3641fe2cff74d)
* Parse `//` as a valid url [Details](https://github.com/parcel-bundler/parcel/commit/a78280affa7e02cb142e51259ea4076ed036600a)
* Improve windows emoji console detections [Details](https://github.com/parcel-bundler/parcel/commit/dba3d49be2d30dfe47a9bd9c88d6fba9015be968)

## [1.4.1] - 2017-12-31

### Added

* Changelog [Details](https://github.com/parcel-bundler/parcel/commit/dc4acd8efebf76116b9e06e89827e56cfa217013)

### Fixed

* http hot reload server printing location as `https://...` [Details](https://github.com/parcel-bundler/parcel/commit/0fcdeb9a9feac10be3ff2485e2487588734a6754)
* Execute bundle() when calling Bundler.middleware() [Details](https://github.com/parcel-bundler/parcel/commit/b9004fc3a0092cdfa0b18e196ab25a79e582b2d1)
* Always parse dependencies if babel ran. [Details](https://github.com/parcel-bundler/parcel/commit/c6991116f0759b865f1a55336c32ba0793fa09c3)

## [1.4.0] - 2017-12-31

### Added

* HTTPS server support [Details](https://github.com/parcel-bundler/parcel/commit/90b968432592f38ecca0ad3b2cb5f7fbfbcd684c)
* GraphQL Support [Details](https://github.com/parcel-bundler/parcel/commit/8f1f497945d4e5102c401e3036c4bc30fd692348)
* Webworker Support [Details](https://github.com/parcel-bundler/parcel/commit/c8a1156d4c2dd5902ba500aa9c25547bfab53eac)
* CSSNano configuration [Details](https://github.com/parcel-bundler/parcel/commit/14e7880be2a147503999e21d4c1114874cc500d7)
* HTMLNano configuration [Details](https://github.com/parcel-bundler/parcel/commit/d11a15e1636ea7c7f291d0cfbf73b75cc719e839)
* Support async plugin loading [Details](https://github.com/parcel-bundler/parcel/commit/bb6e6044b7569fd6745ab915dfd49327d0cbb955)
* Add code sample section to `ISSUE_TEMPLATE` [Details](https://github.com/parcel-bundler/parcel/commit/8a65676023f88a53372ab4bf0b6daada49de6b49)
* Add url dependency for serviceWorker.register calls [Details](https://github.com/parcel-bundler/parcel/commit/0ab0acaecece829392cd452f83014df7c470fc83)
* Fix ignored babel files [Details](https://github.com/parcel-bundler/parcel/commit/22478d368216b24da3bd3e94439b02e356fd4310)

### Fixed

* log-symbols fallback for cross-platform emoji compatibility [Details](https://github.com/parcel-bundler/parcel/commit/0eb4487491fd70390697ad413aeac994fca4309c)
* Use hostname for websocket connection [Details](https://github.com/parcel-bundler/parcel/commit/06d5ffc33dac19fa9ca730bbf939052b500a34ec)
* Standardize empty implementation comment [Details](https://github.com/parcel-bundler/parcel/commit/d763a1aaca70a7892cb4c6611c2540ca1506d107)
* Handle appstore url scheme [Details](https://github.com/parcel-bundler/parcel/commit/494fafc33ec0a3c66b423670a24539896015855f)
* bundling issues when asset parent & commonBundle types differ [Details](https://github.com/parcel-bundler/parcel/commit/127c9b72d20847734049a7db27683279c6784ab6)
* Handle empty assets [Details](https://github.com/parcel-bundler/parcel/commit/4c67f03808dca6cf9b9a47bcd92477e09005da75)
* Minify `Prelude.js` [Details](https://github.com/parcel-bundler/parcel/commit/a0ede06395807cc0f7f6caad7aee2cb1463d41ac)

## [1.3.1] - 2017-12-24

### Fixed

* Maintain html spacing between tags when minimizing [Details](https://github.com/parcel-bundler/parcel/commit/0f40da9bd4249b43d22597f80d0306791e9203f6)
* Incorrect bundle path for raw Assets [Details](https://github.com/parcel-bundler/parcel/commit/38f8aaf173a8ff501ddd02741969089576b42bd6)

## [1.3.0] - 2017-12-22

### Added

* Reason Asset Type [Details](https://github.com/parcel-bundler/parcel/commit/47e91926f1d9ed763ad11cbd39a9b9fbc1986b20)
* Automatically install parser dependencies [Details](https://github.com/parcel-bundler/parcel/commit/6f493f030852f557c299b2c26a565c99e1e9de66)
* UglifyES config support [Details](https://github.com/parcel-bundler/parcel/commit/1947a15d40cc2b7dd91bdc64d02a5d79604ba550)
* Display absolute path on failed dependency resolve [Details](https://github.com/parcel-bundler/parcel/commit/dffeb7d81ea14e9739b372132fd32d8d74d9b368)
* Support `.editorconfig` [Details](https://github.com/parcel-bundler/parcel/commit/6c96b6588afc1b774551c5eda3487c2d0fab6dc0)
* Tests for ES6 Modules resolver [Details](https://github.com/parcel-bundler/parcel/commit/76186779b2a24ce1befc7c5d5b3e783c7b9f5c94)
* ESLint [Details](https://github.com/parcel-bundler/parcel/commit/434b86c92b19e2c7de13a121600d0533c1138169)

### Fixed

* Parse port option as integer [Details](https://github.com/parcel-bundler/parcel/commit/1fa9fef1d1165630b0beabba5d546ee3ccffbec1)
* Make cli.js Node 6 compatible [Details](https://github.com/parcel-bundler/parcel/commit/ac0fbaf40b9cc93b3f428c2b6c124027f56e6e78)
* Remove arrow function from hmr-runtime - IE support [Details](https://github.com/parcel-bundler/parcel/commit/9f5b334d6e04136d93ae428a5eef899371b400e0)
* Start server before bundling [Details](https://github.com/parcel-bundler/parcel/commit/44d0bd6633b71ce3b36b4faeee514182dcc9334a)
* Deterministic bundle trees [Details](https://github.com/parcel-bundler/parcel/commit/539ade1820c3e644586e3161f6b2357a68784142)
* Resolve "module", "jsnext:main" and "browser" before "main" in Package.json [Details](https://github.com/parcel-bundler/parcel/commit/7fcae064b205ab30c2393c3ce68171fd9f47ffc1)
* Remove filename unsafe characters [Details](https://github.com/parcel-bundler/parcel/commit/df021967900fd60d7a58a79191daa26caf68c2b5)
* Don't hash root file [Details](https://github.com/parcel-bundler/parcel/commit/075190c9868c5dd01ec4a935a187e21ae00662e5)
* Use cross-spawn for autoinstalling dependencies on windows [Details](https://github.com/parcel-bundler/parcel/commit/ab3a7d61a4f3e19b129583914fb9fad4c54d8dc6)

## [1.2.1] - 2017-12-18

### Added

* Opencollective [Details](https://github.com/parcel-bundler/parcel/commit/0f554dc2f5c8f2557ec84eee5301b90ffb279764)
* Use `JSON5` to parse config files [Details](https://github.com/parcel-bundler/parcel/commit/bd458660ce38e7a1d25bd9758084acc24418e054)
* Move JSAsset options gathering into seperate function [Details](https://github.com/parcel-bundler/parcel/commit/333c3aa5d20f98a5f3c52635751032d12854c13c)

### Fixed

* Don't use template literals in builtins - IE support [Details](https://github.com/parcel-bundler/parcel/commit/b7b2991d69b960d9f2951828b8145a6d9396ee4e)
* Merge `tsconfig.json` with defaults [Details](https://github.com/parcel-bundler/parcel/commit/86835793a513b43af906a02083eed72b7eb9e0d2)
* Change `parse-json` requires to `JSON5` [Details](https://github.com/parcel-bundler/parcel/commit/ed35a0994d34dfead6b8895ae981d9b05edac361)
* Register `.pcss` extension to CSSAsset [Details](https://github.com/parcel-bundler/parcel/commit/f62d47686698807e43923893affb6f4ce22337ac)
* Websocket error handling [Details](https://github.com/parcel-bundler/parcel/commit/9f27e15bfcefc2e629a97c154ec2391e2a962623)
* Development server index file [Details](https://github.com/parcel-bundler/parcel/commit/c008bb0ac492dbac38e2f13017e3143f40359934)

## [1.2.0] - 2017-12-12

### Added

* Coffeescript support [Details](https://github.com/parcel-bundler/parcel/commit/2d680c0e968cbdda46455ae792b4dbac33dc9753)
* Reload html on change [Details](https://github.com/parcel-bundler/parcel/commit/0ff76bea36135a4b1edbd85a588a4e26c86dcc19)
* `--open` option to automatically launch in default browser [Details](https://github.com/parcel-bundler/parcel/commit/f8b3d55288f4c4a15330daf7d950cc496fde47ed)
* Prettier [Details](https://github.com/parcel-bundler/parcel/commit/548eef92e11711db007b7613ba5530de508d21a0)
* Code of conduct [Details](https://github.com/parcel-bundler/parcel/commit/72c4d47a77d0b4419d54130e2ea2f39ae40b74da)
* User friendly server errors and automatic port switching [Details](https://github.com/parcel-bundler/parcel/commit/87350f44223ea77597f5d2f50c3886ebd6126a42)
* Version option to command description [Details](https://github.com/parcel-bundler/parcel/commit/35c65a34ac41508c3a3bed8944bb478cebc3e071)
* Add badges to readme [Details](https://github.com/parcel-bundler/parcel/commit/644f195341c1a47d49af101716ce2fa8b323a0fe)
* Support JSON comments [Details](https://github.com/parcel-bundler/parcel/commit/7bfe232ba1db4f27278025175cf3818fbc34e65f)
* Add AppVeyor CI [Details](https://github.com/parcel-bundler/parcel/commit/0eb7a930ffcd4fc77b5b6c75e490299f92ca8a8e)
* Use `UglifyES` instead of `UglifyJS` [Details](https://github.com/parcel-bundler/parcel/commit/70663cced00e5f98d3e8e3affbc0ee40a9ab4566)

### Fixed

* Bundle-loader when using esModule [Details](https://github.com/parcel-bundler/parcel/commit/7d1f384122431b90e715161e50a5abf39dc8fd9d)
* Use var over let in builtins for IE support [Details](https://github.com/parcel-bundler/parcel/commit/29515f4f713b093bad9cf8fedd796c4eacb4f38b)
* Add jsm to javascript extensions [Details](https://github.com/parcel-bundler/parcel/commit/cdda0442cc9a00dde5f54ffc643a32e58390034f)
* Log pluginload errors [Details](https://github.com/parcel-bundler/parcel/commit/acdf9792ed53a5909cc5ab638ad0f27403b41957)
* Global env problem [Details](https://github.com/parcel-bundler/parcel/commit/355c63bc956bf24dd7d040e52dd3be2fda47ad9c)
* Exit on build error when using build command [Details](https://github.com/parcel-bundler/parcel/commit/34b84e44573fd583689ccefde5a8bd9f46de203b)
* Remove circular require in Asset.js [Details](https://github.com/parcel-bundler/parcel/commit/7c0acb32bc7374a294f53d758e330c52966919dd)
* Give high priotity to extension of parent [Details](https://github.com/parcel-bundler/parcel/commit/2e3266242f7f2dd01fd21c3ba58d0fb575635e43)
* Fallback to `os.cpus()` for cpu count [Details](https://github.com/parcel-bundler/parcel/commit/9d319afd7683468361dc2f04b253aaca38e779ee)
* Windows test issues [Details](https://github.com/parcel-bundler/parcel/commit/0eb7a930ffcd4fc77b5b6c75e490299f92ca8a8e)
* Raw Asset loading [Details](https://github.com/parcel-bundler/parcel/commit/51b90d7458fca5b10dbaa0605c33223b8884b6e1)
* Normalize path on windows [Details](https://github.com/parcel-bundler/parcel/commit/0479dee763fc9d79c057c86233cb660c6022a92c)
* Make hmr-runtime ES3 compatible [Details](https://github.com/parcel-bundler/parcel/commit/d17dccccf4480e440c1898911f304efe6040439f)
* Dynamically importing js assets with raw assets children [Details](https://github.com/parcel-bundler/parcel/commit/dc52638a27d41b1eadf25ecc5d93bfe6727182c7)
* Package.json loading issues for plugin loading [Details](https://github.com/parcel-bundler/parcel/commit/7469a150bf5accecdcfc430365572601527302b9)

## [1.1.0] - 2017-12-08

### Added

* Typescript support [Details](https://github.com/parcel-bundler/parcel/commit/757b67362e1fce076241fa31afe2179db93cff18)
* Browser gets notified of errors [Details](https://github.com/parcel-bundler/parcel/commit/d9d8bab2a9bcd2efd23bd824d4c24af1d66a3f77)
* Community section to Readme [Details](https://github.com/parcel-bundler/parcel/commit/11d109b4b4e03f8ab5da253f9c70b0e6e11e8f3b)
* More helpfull json parsing error messages using `parse-json` [Details](https://github.com/parcel-bundler/parcel/commit/2b26f9691d3dc489c509476718fa852b231ffde1)
* Issue template [Details](https://github.com/parcel-bundler/parcel/commit/f8dd2f2aea167f011a5c885b20390521798c8c9f)

### Fixed

* Print stack traces on error [Details](https://github.com/parcel-bundler/parcel/commit/4ab9b878a2b1ea280afaac690fb0990947c4323e)
* Merge `postcss-modules` config [Details](https://github.com/parcel-bundler/parcel/commit/582f8db1f735ecbbd4f5c93202ba0f6a6c24f8ca)
* Default to `NODE_ENV` development on serve [Details](https://github.com/parcel-bundler/parcel/commit/29f8df78788061a7f406059bc55c8ede428a020d)
* Disable flakey macOS FS events in watcher in the tests [Details](https://github.com/parcel-bundler/parcel/commit/e69c83d9db38fac8d1e525bdf03a883b551f506d)
* Sort child bundles by asset names to avoid race condition in tests [Details](https://github.com/parcel-bundler/parcel/commit/c49e43a5a6f4b602d07f72f76b8443bf37203a3f)

## [1.0.3] - 2017-12-07

### Added

* Add version to cache key [Details](https://github.com/parcel-bundler/parcel/commit/f3287ab76f5921d1ec7273bee42871179fe3ca85)
* Travis tests environment, build script and contribution docs [Details](https://github.com/parcel-bundler/parcel/commit/90f69ff30b9b239b537ca1b01f8ce7fb1d08ce6a)

### Fixed

* File url bugfix for Firefox [Details](https://github.com/parcel-bundler/parcel/commit/90a5373d629bebdc9761ddb784e683190bdcc35a#diff-78cb52acd60299e5f6fd26a716d97293)
* Windows path bugfix [Details](https://github.com/parcel-bundler/parcel/commit/67cd3b0678b835f3a21134800bc0f9c9b8d599e2)
* Default only exports [Details](https://github.com/parcel-bundler/parcel/commit/860a748898f8a0fee749aec2e6bdc3eaabf0ce87)
* Public URL in normalizeOptions [Details](https://github.com/parcel-bundler/parcel/commit/9b066122ed40afc05f5eb20ea0cc1ec9e748592b)
* Do not try to import data:, tel:, mailto:, something: URLS [Details](https://github.com/parcel-bundler/parcel/commit/781b7ecd114edd63fe6ad04dfc1408c9a611f2f5)

## [1.0.2] - 2017-12-06

### Added

* Add github repository to `package.json` [Details](https://github.com/parcel-bundler/parcel/commit/88bdf1e474d8bc8af3f770b431d011239f1ede14)

### Fixed

* Improved public url checking using `is-url` instead of regex [Details](https://github.com/parcel-bundler/parcel/commit/92be140ad55fcdef7b34baa6718bc356274e5e8f)

### Removed

* `babel-preset-es2015` removed from dev dependencies [Details](https://github.com/parcel-bundler/parcel/commit/4d87814f7201d70cfa5db3b457915c508378c9e6)

## [1.0.1] - 2017-12-05

* Initial Parcel-bundler core
