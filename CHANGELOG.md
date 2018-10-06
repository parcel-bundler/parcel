# Changelog

All notable changes to parcel will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and parcel adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [1.10.2] - 2018-10-06

### Added

- Add `<image>` as a valid element type to bundle in `<svg>` tags [Details](https://github.com/parcel-bundler/parcel/pull/2113)
- Resolving `.postcssrc.json` as a PostCSS config [Details](https://github.com/parcel-bundler/parcel/pull/2115)
- Add loaders when bundling workers [Details](https://github.com/parcel-bundler/parcel/pull/2092)

### Fixed

- Fix hoist of modules with multiple aliases [Details](https://github.com/parcel-bundler/parcel/pull/2077)
- Fix hoisting of optional require calls [Details](https://github.com/parcel-bundler/parcel/pull/2078)
- Fix safari 10 compatibility for terser [Details](https://github.com/parcel-bundler/parcel/pull/2103)
- Fix HMR for Pug assets [Details](https://github.com/parcel-bundler/parcel/pull/2091)
- Don't load existing sourcemaps if sourcemaps are disabled [Details](https://github.com/parcel-bundler/parcel/pull/2089)
- add missing --no-autoinstall flag to build command [Details](https://github.com/parcel-bundler/parcel/pull/2076)

## [1.10.1] - 2018-09-26

### Fixed

- Fix error when node.id is undefined instead of null

## [1.10.0] - 2018-09-25

### Added

- Babel 7 support [Details](https://github.com/parcel-bundler/parcel/pull/1955)
- HTML Bundle loader [Details](https://github.com/parcel-bundler/parcel/pull/1732)
- Process inline scripts and styles [Details](https://github.com/parcel-bundler/parcel/pull/1456)
- Added LD+JSON asset [Details](https://github.com/parcel-bundler/parcel/pull/1936)
- Add support for Elm assets [Details](https://github.com/parcel-bundler/parcel/pull/1968)
- Support optionally bundling node_modules for `--target=node` [Details](https://github.com/parcel-bundler/parcel/pull/1690)
- Import existing sourcemaps [Details](https://github.com/parcel-bundler/parcel/pull/1349)
- Import GraphQL files from other GraphQL files [Details](https://github.com/parcel-bundler/parcel/pull/1892)
- Automatically strip flow types [Details](https://github.com/parcel-bundler/parcel/pull/1864)
- SugarSS Support [Details](https://github.com/parcel-bundler/parcel/pull/1941)
- Minimal verbose/debug mode [Details](https://github.com/parcel-bundler/parcel/pull/1834)
- User friendly error on failed entrypoint resolving [Details](https://github.com/parcel-bundler/parcel/pull/1848)
- Support for SharedWorkers [Details](https://github.com/parcel-bundler/parcel/pull/1907)
- Add Object Spread to default Babel transforms [Details](https://github.com/parcel-bundler/parcel/pull/1835)
- Update help message for `--public-url` [Details](https://github.com/parcel-bundler/parcel/pull/1846)
- Support HTML5 history mode routing [Details](https://github.com/parcel-bundler/parcel/pull/1788)
- Split cache into multiple folders for faster FS [Details](https://github.com/parcel-bundler/parcel/pull/1322)
- Support array in package.json's sideEffects property [Details](https://github.com/parcel-bundler/parcel/pull/1766)
- Added stub for require.cache [Details](https://github.com/parcel-bundler/parcel/pull/1960)
- Added dotenv-expand to expand env vars [Details](https://github.com/parcel-bundler/parcel/pull/2014)
- Update Typescript to v3.0.0 [Details](https://github.com/parcel-bundler/parcel/pull/1840)
- Add `--no-content-hash` option to build cli [Details](https://github.com/parcel-bundler/parcel/pull/1934)

### Fixed

- Exit process on Error [Details](https://github.com/parcel-bundler/parcel/pull/1933)
- Fix non updating asset hashes [Details](https://github.com/parcel-bundler/parcel/pull/1861)
- Fix Sass url resolving [Details](https://github.com/parcel-bundler/parcel/pull/1909)
- WorkerFarm Cleanup [Details](https://github.com/parcel-bundler/parcel/pull/1918)
- Fix infinite loop in resolver when using `~/...` imports [Details](https://github.com/parcel-bundler/parcel/pull/1881)
- Default to Dart-Sass and add backwards compatibility for node-sass [Details](https://github.com/parcel-bundler/parcel/pull/1847)
- Validate if a PostCSS config is an object [Details](https://github.com/parcel-bundler/parcel/pull/1862)
- VSCode syntax highlight with PostCSS in Vue Component style tag [Details](https://github.com/parcel-bundler/parcel/pull/1897)
- Glob support in less imports [Details](https://github.com/parcel-bundler/parcel/pull/1845)
- Generate unique certificate serial number [Details](https://github.com/parcel-bundler/parcel/pull/1830)
- Keep name in sourcemaps mappings [Details](https://github.com/parcel-bundler/parcel/pull/1804)
- Replace slack with spectrum badge [Details](https://github.com/parcel-bundler/parcel/pull/1785)
- Use esnext with typescript and scope hoisting [Details](https://github.com/parcel-bundler/parcel/pull/1781)
- Fix sourcemaps failing on refresh/hmr [Details](https://github.com/parcel-bundler/parcel/pull/1755)
- Support sideEffect: false with CommonJS [Details](https://github.com/parcel-bundler/parcel/pull/1770)
- Get only existing package main [Details](https://github.com/parcel-bundler/parcel/pull/1577)
- Load minified built-in if available [Details](https://github.com/parcel-bundler/parcel/pull/1749)
- Support error strings in workers [Details](https://github.com/parcel-bundler/parcel/pull/1761)
- Terminate workerfarm when using the API [Details](https://github.com/parcel-bundler/parcel/pull/1760)
- Fix comment typo [Details](https://github.com/parcel-bundler/parcel/pull/1739/files)
- Fix dotenv package error [Details](https://github.com/parcel-bundler/parcel/pull/1953)
- Don't resolve slash and tilde paths twice [Details](https://github.com/parcel-bundler/parcel/pull/1993)
- bundle name hash-key generation is not environment independent [Details](https://github.com/parcel-bundler/parcel/pull/2002)
- Don't modify script nodes with text/html type [Details](https://github.com/parcel-bundler/parcel/pull/1924)
- Fix various windows bugs & tests [Details](https://github.com/parcel-bundler/parcel/pull/1965)
- Cross-platform deterministic asset ids [Details](https://github.com/parcel-bundler/parcel/pull/2020)
- allow empty string in meta [Details](https://github.com/parcel-bundler/parcel/pull/2027)
- fixed watch not working when NODE_ENV is production [Details](https://github.com/parcel-bundler/parcel/pull/2024)
- Incorrect casing for Logger require [Details](https://github.com/parcel-bundler/parcel/pull/2021)
- fix security vuln [Details](https://github.com/parcel-bundler/parcel/pull/1794)
- Remove wasm-gc from RustAsset [Details](https://github.com/parcel-bundler/parcel/pull/2048)

## [1.9.7] - 2018-07-15

### Fixed

- Fix nested async imports from a shared module [Details](https://github.com/parcel-bundler/parcel/pull/1724)
- Prevent nameclashes with internal variables with tree shaking [Details](https://github.com/parcel-bundler/parcel/pull/1737)

## [1.9.6] - 2018-07-11

### Fixed

- Fix ora spinner in CI environments [Details](https://github.com/parcel-bundler/parcel/commit/8670fd6962b0813f6cf82bc6a6e5430376ffc037)

## [1.9.5] - 2018-07-11

### Added

- Use fast-glob [Details](https://github.com/parcel-bundler/parcel/commit/06fb3c807218d0ee40446f56d4fb12c280894756)
- Use user installation of `cssnano` [Details](https://github.com/parcel-bundler/parcel/commit/8cee316877d65ec8c1e57bee2e25630db0cad1fa)
- Upgrade to cssnano v4 [Details](https://github.com/parcel-bundler/parcel/commit/5e924b466d5998a20afd2e8290f67878511f4cb7)
- Logger improvements [Details](https://github.com/parcel-bundler/parcel/commit/c96612087e4dc6576b2cc5367ff0e66219f7147a)
- Watch PostHTML plugins dependencies [Details](https://github.com/parcel-bundler/parcel/commit/038ade609e8dcd89ac21548adea541ca99e6a7ba)
- Add support for node 10 [Details](https://github.com/parcel-bundler/parcel/commit/cae25f6fc0f1d35de39b1d5603094b784e8ecd9e)
- Workerfarm improvements [Details](https://github.com/parcel-bundler/parcel/commit/7b38f4f2c2b1d426131335b56f7bc50b8230c53c)
- Use minify prelude only minify option [Details](https://github.com/parcel-bundler/parcel/commit/b52548b02e47215e668e509919e8fd962141e8a9)
- Deterministic asset ids [Details](https://github.com/parcel-bundler/parcel/commit/e34a4d097ef0624890589f471e4a977367da568a)

### Fixed

- JSPackager deduplication now accounts for differences in absolute dependency paths [Details](https://github.com/parcel-bundler/parcel/commit/f699e812eab5276af22052f3ace1e4fd651f4f72)
- Fix worker bundle hoisting [Details](https://github.com/parcel-bundler/parcel/commit/1ab05580396774f44b587d8ec3dc2d12ca13c2a0)
- Prioritize browser field over module [Details](https://github.com/parcel-bundler/parcel/commit/96856bacd75bedcf1a09e89a66ee7083d8e069d0)
- Fix aliasing of folder relative to project folder [Details](https://github.com/parcel-bundler/parcel/commit/69b64cc76530ea038f54bda239b1d271c6a09562)
- Only watch directories on macOS [Details](https://github.com/parcel-bundler/parcel/commit/57f4c4592dcfc008bbdc107386f3448c2e75e820)
- Fix generating names when outside of the entry directory [Details](https://github.com/parcel-bundler/parcel/commit/2bc6ed9ab63a35533c1637f558f64253defd789b)
- Handle invalidating cache if dependency is a glob [Details](https://github.com/parcel-bundler/parcel/commit/ec3aea90dc5c122184e24a4f57e25dbaa99a8935)
- Fix import deep wildcards with tree-shaking [Details](https://github.com/parcel-bundler/parcel/commit/23ee7c2a5ff806aac605a2bca95ac48310ef9a11)
- Fix tree-shaking named import on wrapped module [Details](https://github.com/parcel-bundler/parcel/commit/a42dfeba6f79175028a7227c920b18d21271066a)
- Fix circular deps in isolated bundles (e.g. workers) [Details](https://github.com/parcel-bundler/parcel/commit/f2deb5cbbdf1381b6202d56e3884e14423bd860c)
- Fix tree-shaking wildcards with sideEffects: false [Details](https://github.com/parcel-bundler/parcel/commit/764f568993a11689b7014df1977c18f6bda42e4c)
- Fix 'buildStart' event is not firing [Details](https://github.com/parcel-bundler/parcel/commit/2fa38c1874fb6b279449b3eb317d5f1e678769d7)

## [1.9.4] - 2018-07-01

### Added

- Upgrade Typescript to 2.9 [Details](https://github.com/parcel-bundler/parcel/commit/3a8f38cc0d8b5d71d158eeb7c7526e01be746c28)
- Upgrade DEFAULT_ENGINES node to Node 8 [Details](https://github.com/parcel-bundler/parcel/commit/fd2294a586b24b9d9a76c86afbde3664698d86d2)
- Add a buildError event to bundler [Details](https://github.com/parcel-bundler/parcel/commit/ead365ca4f481e9163345a849d02aff4934d448e)
- Use process.env.PARCEL_MAX_CONCURRENT_CALLS environment variable [Details](https://github.com/parcel-bundler/parcel/commit/4808c0c03370e475a4303df5ef532f68d59a09d1)

### Fixed

- Fix Sass dependencies can not be watched when includePaths is a relative path [Details](https://github.com/parcel-bundler/parcel/commit/6ccaf6db73b0d800d3db7fbbab2555f5b1f8c526)
- Replaced fwd slashes with backslashes for win to fix sass deps watch [Details](https://github.com/parcel-bundler/parcel/commit/9200e9a4d2f882a7549d21fdda8e5ce3e4af4397)
- Fix sourcemap file size in report [Details](https://github.com/parcel-bundler/parcel/commit/729f252cf90262356b9c93b9e003b8bce2a03cd3)
- fix build not exiting in dev env [Details](https://github.com/parcel-bundler/parcel/commit/14fabe9df341a9b6bba6349f5c1c3607ee1b570d)
- Prevent postcss-modules plugin config from being deleted after first run [Details](https://github.com/parcel-bundler/parcel/commit/859975165e2417f036014438907bf8c241dcbeaf)

## [1.9.3] - 2018-06-24

### Fixed

- Set user provided NODE_ENV if provided with build command [Details](https://github.com/parcel-bundler/parcel/commit/1b6a93f3efa1d8a4e9e04beda1a5545770e9fb07)
- Fix bugs related to watching symlinks [Details](https://github.com/parcel-bundler/parcel/commit/7f4049d379f5083634ab63e59c51eebaabdc4b7a)
- add cache-dir option to cli [Details](https://github.com/parcel-bundler/parcel/commit/12ddda778cc5283ab1409443aab42340f08b4cb7)
- Fix tree-shaking DCE [Details](https://github.com/parcel-bundler/parcel/commit/b62132ceaf8d3c2019d7e86a9e987e13ee196c75)
- Fix writing hashed bundle names to the cache [Details](https://github.com/parcel-bundler/parcel/commit/1bd5fcc9038e47fcc233543e32903b6e02aeb3a1)

## [1.9.2] - 2018-06-18

### Fixed

- Fix unintended Vue asset supplemental code insertion [Details](https://github.com/parcel-bundler/parcel/commit/1701f9bbc365f1aaa945603a64c57b07d3afee5e)
- fix 'Cannot read property 'posthtml' of null [Details](https://github.com/parcel-bundler/parcel/commit/c94624ec976d63aa5da4db78d20985ec15ec5435)

## [1.9.1] - 2018-06-16

### Fixed

- fix relative paths being the same as node modules [Details](https://github.com/parcel-bundler/parcel/commit/f536e8bf8d8212bb314328458c8da2b4bcd8c15f)
- Fix ES6 re-export of CommonJS modules with tree shaking [Details](https://github.com/parcel-bundler/parcel/commit/9e2f9abc2066e4c5aac05db001cf6279655bcee7)

## [1.9.0] - 2018-06-14

### Added

- Tree shaking + scope hoisting for ES6 and CommonJS modules [Details](https://github.com/parcel-bundler/parcel/commit/0ac4e297adf95cff78de361fc4867fd412ec3b60)
- Put filewatcher in a worker, for better stability and performance [Details](https://github.com/parcel-bundler/parcel/commit/af4cd330e91197fd88d826fd17440452f64e5c8a)
- Cache resolved paths of dependencies [Details](https://github.com/parcel-bundler/parcel/commit/adeee429b60da2c7073d0e3b280b588cf22ce03e)
- Custom less filemanager [Details](https://github.com/parcel-bundler/parcel/commit/87b1ea9818ae0bafaf05b5cd57bdb7d8d96dfbe8)
- support for sass specific import syntax [Details](https://github.com/parcel-bundler/parcel/commit/099a98ed46fcad8f0ad9725a2d8976c8b9d4a448)
- Allow --https for watch [Details](https://github.com/parcel-bundler/parcel/commit/98a293f79bf822bca5f97db9155ee30ddaa03632)
- Fix browser entry-point resolution [Details](https://github.com/parcel-bundler/parcel/commit/98a293f79bf822bca5f97db9155ee30ddaa03632)
- Use config.locals to render pug template [Details](https://github.com/parcel-bundler/parcel/commit/15eb885f5b696f831194199dc75e5dc91b84d5e0)
- Use async modules when possibles [Details](https://github.com/parcel-bundler/parcel/commit/83dfa3ea00fc1538a9e0d770f37454ca2d558d65)
- Add a bundlestart event [Details](https://github.com/parcel-bundler/parcel/commit/304eb5f660cfa2630e34cc60848f875a15a3ed18)
- Add unit tests for line counter [Details](https://github.com/parcel-bundler/parcel/commit/dc113250ce25674395c292a66184f35bbd5db04c)
- Use async FS in tests [Details](https://github.com/parcel-bundler/parcel/commit/181a63f156e1d55056fee96ea5841b749a55470f)
- Use async fs on new linecounter tests [Details](https://github.com/parcel-bundler/parcel/commit/9861c46b2cff1c32c5d20f33ff59441b2630ec0e)
- Make CSS assets async [Details](https://github.com/parcel-bundler/parcel/commit/0d63879d8e68db3618b0f57637d03a9a8b2b6259)
- Enable posthtml-parse options in posthtmlrc [Details](https://github.com/parcel-bundler/parcel/commit/c600d4471bf584045b3edc0a7b080584d11d8a97)
- Enforce Prettier (check if prettier is run in lint script) [Details](https://github.com/parcel-bundler/parcel/commit/523ee0fcabd194e2daf79f13ab7dd9d0b23203e1)
- Add support for Cargo workspaces in Rust integration [Details](https://github.com/parcel-bundler/parcel/commit/24f28bc5d7dd4324841209379d2823654ab9c8e7)
- Surface Bundler error to browser [Details](https://github.com/parcel-bundler/parcel/commit/82a80bbf6518b526d99cd1bac34be9f53494dd68)
- Programatically pass env vars as a whitelist [Details](https://github.com/parcel-bundler/parcel/commit/a662f90a93f2b5b61eebc2aea67c5a77467963e7)

### Fixed

- Fix bundle hoisting when asset is already in the common bundle [Details](https://github.com/parcel-bundler/parcel/commit/d8db6bae08342764b3989187ad868c4717310481)
- Only resolve env vars on bundling when --target=browser [Details](https://github.com/parcel-bundler/parcel/commit/db07fa5f4d5ee7405fec3ca17e86ed451b27d63a)
- improve the time reported by the bundler [Details](https://github.com/parcel-bundler/parcel/commit/59626051d0be7335147703d31d65212cd2d5eeaa)
- clear console before accepting updates, not after [Details](https://github.com/parcel-bundler/parcel/commit/08f938919e4c4008d810170e0b8a4a3fccf27242)
- Lookup correct generated output for bundle type in RawPackager [Details](https://github.com/parcel-bundler/parcel/commit/b2a08c4ac1e05b182e5cde73f8dc0e9f4dcdf133)
- Remove extra argument passed to addAssetToBundle in JSPackager [Details](https://github.com/parcel-bundler/parcel/commit/33ed91349d32a4011acf1bd90d4e3c362998118b)
- Fix indented syntax type for single file vue components [Details](https://github.com/parcel-bundler/parcel/commit/f74331721479e29af84dc72487672aeabfaf8657)
- Fix Vue asset supplemental code concatenation [Details](https://github.com/parcel-bundler/parcel/commit/46fb97a2d079e1769422f8525eb5d3d1eac0bfcc)
- Add dependencies referenced by posthtml-include [Details](https://github.com/parcel-bundler/parcel/commit/3988ffcf66033722c41d767e714ed1a01b572b27)
- node-sass accepts importer as single function or array of functions [Details](https://github.com/parcel-bundler/parcel/commit/1e9556c0054e749a1659d222f2816956949654ff)
- Get mtime of folder on wildcard imports [Details](https://github.com/parcel-bundler/parcel/commit/d689fde1ba2d7953264b012874010238bbcdc9a9)
- Fix vue test [Details](https://github.com/parcel-bundler/parcel/commit/83907d8b4e2855406964b02b336c85ac6ab0fa26)
- Fix absolute and tilde paths for url dependencies [Details](https://github.com/parcel-bundler/parcel/commit/16149185bdd386cf478b08629fd2776dce76c943)
- Fix failing appveyor test [Details](https://github.com/parcel-bundler/parcel/commit/1cb05e036482bee05a4fef619a9a4b7a9c62b416)
- Fix worker environment variable [Details](https://github.com/parcel-bundler/parcel/commit/d3e04b5bcb9f930dfe0ce9d0891de579d5bde5cf)
- Add `test/dist` to .prettierignore [Details](https://github.com/parcel-bundler/parcel/commit/fc4a9f67c364830ca998e95cf0c00e15cc396fc2)
- Fix typo in uglify.js [Details](https://github.com/parcel-bundler/parcel/commit/dc10531e27c4ba6cb33ff52d49eddf57b2d17b8b)
- Pass compiler of @vue/component-compiler-utils to parser. [Details](https://github.com/parcel-bundler/parcel/commit/40fb76f8d12fe17b4e8e3eebe1a988d11d31e106)
- Fix package.json configs [Details](https://github.com/parcel-bundler/parcel/commit/eda41e1ca9c3c8dd083196d0c6c54c52444b82cb)
- change Uglify to Terser [Details](https://github.com/parcel-bundler/parcel/commit/86731cc5b3c678844605b60c7247ae424b07125a)

### Removed

- Don’t pass package.json and options over IPC [Details](https://github.com/parcel-bundler/parcel/commit/2f7be14aa9eea3fa9e8ee61591c001937d9757a1)

## [1.8.1] - 2018-05-04

### Fixed

- Loading modules with AMD Defines [Details](https://github.com/parcel-bundler/parcel/commit/674b17d732c492c847fbbc943ab44adab2e78625)

## [1.8.0] - 2018-05-03

### Added

- Add support for multiple entry points [Details](https://github.com/parcel-bundler/parcel/commit/7cbbeef2bf5b6e2d83af55344218da72006d325c)
- Support source field in package.json to enable babel on symlinked modules [Details](https://github.com/parcel-bundler/parcel/commit/d517132890318586c0ccd45905dc66bf52425844)
- Expose modules as UMD [Details](https://github.com/parcel-bundler/parcel/commit/2af3fe3bb6d241d077f216c4bb711c59aa4069d0)
- Use parcel's resolver for sass imports [Details](https://github.com/parcel-bundler/parcel/commit/31190cff9444f8907bb1e854db1af1be68363f39)
- Update default browser engines to > 0.25% marketshare [Details](https://github.com/parcel-bundler/parcel/commit/e9b249cdc3b9b819c324077c61bd94ac9c429ce3)
- Ignore dependencies in falsy branches [Details](https://github.com/parcel-bundler/parcel/commit/a176dedc3ec60e88f8899614377d3f1fabe54ef7)
- Clear the console in browser on each HMR [Details](https://github.com/parcel-bundler/parcel/commit/1a688cd7684262d55f37eebe6993506f3040ecf6)
- Watch directories instead of individual files to fix EMFILE errors [Details](https://github.com/parcel-bundler/parcel/commit/d67b76c8c62792f37ca5e5071be533198093f1ae)

### Fixed

- Prevent build from breaking when .scss file is empty [Details](https://github.com/parcel-bundler/parcel/commit/7a2ba16de58a11f84e37b62537c4a1cc54f3f478)
- Handle empty config files [Details](https://github.com/parcel-bundler/parcel/commit/11a788247c4e4d2abfba33d56e47c8422b75c447)
- Update dependency with security vuln [Details](https://github.com/parcel-bundler/parcel/commit/06999a08f252b40344f75c5956c04c107d5502f5)
- Minor change to mkHandle in workerfarm [Details](https://github.com/parcel-bundler/parcel/commit/0d984a563f72798cc0c08e9a27bc0e6e077a0b47)
- Don't start server if target isn't browser [Details](https://github.com/parcel-bundler/parcel/commit/9064b3b6b34cba08d6c33e5d88298485b1ee87f7)
- Let worker return early instead of throw on unknown messages [Details](https://github.com/parcel-bundler/parcel/commit/3fe54a690bc8a33ddf0f458893ba108af3329db3)
- change default behaviour to keep default values of HTML form elements [Details](https://github.com/parcel-bundler/parcel/commit/ac3f8ca61b5045d3a3e77a136befe0ac48f81176)
- Fix autoinstall infinite loop [Details](https://github.com/parcel-bundler/parcel/commit/19b9fc67878f189df3a8b8e104245ddcb644436d)
- Allow spaces in filenames [Details](https://github.com/parcel-bundler/parcel/commit/fb6912da20b377be33ea82442579a0244f27ad37)
- Update deps [Details](https://github.com/parcel-bundler/parcel/commit/ec98a951393587a6e1002035c56b3e41134be844)
- Fix reference pass error in package config [Details](https://github.com/parcel-bundler/parcel/commit/a36b9124b559d65a724da74f2611a15d3122626f)
- Remove `eval` usage. Fixes CSP cases. [Details](https://github.com/parcel-bundler/parcel/commit/b032b859a1bcc4f3e734576c704afb52821235fc)
- Remove jsnext:main [Details](https://github.com/parcel-bundler/parcel/commit/f75941c3cfeb189578e3f2f9579dc9909da1d7c0)
- fix for outFile option; respect file-extension [Details](https://github.com/parcel-bundler/parcel/commit/55e27e0b9f83f3588685de8bcba18167e49c3b1f)

## [1.7.1] - 2018-04-15

### Fixed

- Fix scoped plugin packages [Details](https://github.com/parcel-bundler/parcel/commit/9792f48a8f8e9a18ea3d46521f742b36ceffbd04)
- Fix writing files in subfolders inside dist directory [Details](https://github.com/parcel-bundler/parcel/commit/0e1863bd348c03563f7e6d9a0ba0b1c07fcdbe12)
- Update addBundleLoader to accept multiple targets [Details](https://github.com/parcel-bundler/parcel/commit/9f3f30a209c3a9e7534088065cfad16dcf4b9fff)
- Fix sourcemap reference in JS output [Details](https://github.com/parcel-bundler/parcel/commit/28b87cf03425ca4214639bde9fbc334ed04d25b8)
- Sourcemap sourceRoot [Details](https://github.com/parcel-bundler/parcel/commit/3b1a5853b83d0246b3b467b86619019f3884a08f)
- Fix serving files with query params [Details](https://github.com/parcel-bundler/parcel/commit/3435c4c10c7234f292ac6809c5fbd680c6a915c8)
- Give priority to styl files in StylusAsset resolver [Details](https://github.com/parcel-bundler/parcel/commit/89952d70dd98042ce86c39e066f3f4edd5afbaf3)
- Bump dependencies [Details](https://github.com/parcel-bundler/parcel/commit/41895634469a958a0c98f8178a623f91380264fb)
- Fix asset size always be zero when building vue project [Detailds](https://github.com/parcel-bundler/parcel/commit/25a054f30670ffd3ef12890fed145a0bf21c0883)
- Custom workerfarm, BI-Directional IPC - run all npm/yarn installs on the main process [Details](https://github.com/parcel-bundler/parcel/commit/69625e057f350e5f7cbfd6e2f2b162180a289a67)

## [1.7.0] - 2018-03-28

### Added

- Add `.vue` file support [Details](https://github.com/parcel-bundler/parcel/commit/ba93b875f9503646b175890501d199b022ba54b9)
- New faster resolver supporting absolute and tilde paths, and aliases [Details](https://github.com/parcel-bundler/parcel/commit/32c38e599161372cd47924f0f4cf2aae32eb5b83)
- Content hash output file names in production [Details](https://github.com/parcel-bundler/parcel/commit/76fa1edb69af12853743f04488b2b925c058c328)
- Automatically install missing dependencies that you `require` in your code [Details](https://github.com/parcel-bundler/parcel/commit/fc654d76dc5b5691219ba441985bcf71178c1cf3)
- Production sourcemaps support via uglify [Details](https://github.com/parcel-bundler/parcel/commit/d9f3c259c08770ee370ed2b50909c333f9557bdf)
- Add Pug and Jade support [Details](https://github.com/parcel-bundler/parcel/commit/09a959d31bcaa9329f591bace573e2956ce27c7c)
- Add GLSL assets support [Details](https://github.com/parcel-bundler/parcel/commit/01e7c448f5f3a4ccdb832448ab549fdc2acebc92)
- Add overlay for build errors when using HMR [Details](https://github.com/parcel-bundler/parcel/commit/32c796dde989f7a76a8a6c332edf8c77940bd189)
- Implement pipelines to compose multiple asset types together [Details](https://github.com/parcel-bundler/parcel/commit/8a95f70ff04da6cc32c92278155b112cb37105f0)
- Add --hmr-port and --hmr-hostname options to parcel watch [Details](https://github.com/parcel-bundler/parcel/commit/cafb6ef8f96f0159f22de9e3eb89773709ec9e50)
- Add support for specifying SSL certificate & key [Details](https://github.com/parcel-bundler/parcel/commit/e7f9c64016b3f5dc53230bddf36d0d04b0389590)
- Allow specifying which browser to open with `--open` option [Details](https://github.com/parcel-bundler/parcel/commit/9858937e187b2c1d7ce27fcdfb944b168063aab4)
- Add `data` config option so it is possible to include global scss variables [Details](https://github.com/parcel-bundler/parcel/commit/86045d3b81062ddd0e66075182f237d6f7ba883e)
- Add `--log-level` option [Details](https://github.com/parcel-bundler/parcel/commit/fc041d03c36bf41ea73c398e8d177de1a456e796)
- Add support for data attr of object element [Details](https://github.com/parcel-bundler/parcel/commit/6e8ae0d97c8bb1114b3b53cf6ce0a082b066e51d)
- Add useBuiltIns babel-preset-env option [Details](https://github.com/parcel-bundler/parcel/commit/e26d443c3f9327bae3e89a08517789ce00bcf1f0)
- Support code splitting and loading WASM with --target=node [Details](https://github.com/parcel-bundler/parcel/commit/9d6061c2ede15af601764ec102389ba8f3f5f790)

### Fixed

- Fix hmr runtime error [Details](https://github.com/parcel-bundler/parcel/commit/842b9d8ddc449ca5e9b0b2b324229dd6c85b5c27)
- Add server reference to bundler [Details](https://github.com/parcel-bundler/parcel/commit/a24247155e1a21f431d39c9c1c66a782d4353e5f)
- Fix error when no "targets" options in .babelrc [Details](https://github.com/parcel-bundler/parcel/commit/69f7c6d2211ddc30dfbdfb4a8567da4542f094f1)
- Refactor prettifySize [Details](https://github.com/parcel-bundler/parcel/commit/f897bf72819ea0a3bfe6522fc5aa73f47b84f6c2)
- Fix property descriptor of config.internal in transforms/babel.js [Details](https://github.com/parcel-bundler/parcel/commit/eaf51d01462b353aeaf78ebe80d797477ae1938d)
- only transform safe cssnano minifiers [Details](https://github.com/parcel-bundler/parcel/commit/55814c0da0be226924d6f3077d0c2d5f62cc8335)
- fix electon hmr bug [Details](https://github.com/parcel-bundler/parcel/commit/88630f2a7aebf141ae060f9dc6edaa1dc2089f37)
- Fix HMR hostname in browser [Details](https://github.com/parcel-bundler/parcel/commit/0dc062f77e36a19297dac542be33cded04580e89)
- Fix srcset not working for `source` element [Details](https://github.com/parcel-bundler/parcel/commit/c469751e145a426fee2f1de27ccb2a747c7f5d1e)
- Update htmlnano [Details](https://github.com/parcel-bundler/parcel/commit/a7b72f25e275a596e98716cdc15d78fdb23f9992)
- Fix svg dependencies not being found when using minification [Details](https://github.com/parcel-bundler/parcel/commit/e3c90c40f2d7d951b1d6e59f8455d0071a539163)
- Set TypeScript option esModuleInterop to true by default [Details](https://github.com/parcel-bundler/parcel/commit/800268435a8465660f8569f7ba30a94c2b1f75a1)
- HTML bundle serving bug [Details](https://github.com/parcel-bundler/parcel/commit/43cab32ece825e9d38b3abe55fa0fde06052864d)
- Change default public-url to / [Details](https://github.com/parcel-bundler/parcel/commit/3d704c69835f2e7e663dd982851d6a11587f5596)
- Make --help same as help command [Details](https://github.com/parcel-bundler/parcel/commit/59c8d8d57c0a5b7432a37ac5b011f43455e7e228)
- Make -h same as help command [Details](https://github.com/parcel-bundler/parcel/commit/96f1e4abcefe0c5bc127d15a2d8041972f679568)
- Close hmr server when HMRServer.stop() is called [Details](https://github.com/parcel-bundler/parcel/commit/4bd32f2f52dc7fec7af15d4b45a7582926bd27a6)
- Fix methods of LazyPromise [Details](https://github.com/parcel-bundler/parcel/commit/74438d43ed88954c3be9da290df648ff6df1463c)
- Ignore require if it is defined as a local variable [Details](https://github.com/parcel-bundler/parcel/commit/12b649b914901ea0c92700288e57b68da55aafd4)
- Check browserslist prop in package.json for environments [Details](https://github.com/parcel-bundler/parcel/commit/39e4f7a254ae639c67410e6c4daa7de8e557bd33)

## [1.6.2] - 2018-02-19

### Added

- JSX support for Nerv [Details](https://github.com/parcel-bundler/parcel/commit/1e1297509c50016b16ac6d9f9ec67bf9f63ec4db)
- Add JSX support for Hyperapp. [Details](https://github.com/parcel-bundler/parcel/commit/246edd4fdc2682704ea9b19d97bd4fbf5f72c017)

### Fixed

- Fix babel handling for node: DEFAULT_ENGINES [Details](https://github.com/parcel-bundler/parcel/commit/c7ba56a96d2a135d6b95ec458789e5831e1c0828)
- Remove unnecessary files from npm [Details](https://github.com/parcel-bundler/parcel/commit/6d9e68cbdb06f2c8a05ba31fbc9dde01f0f83d96)
- Use babel-register for tests only with node < 8 [Details](https://github.com/parcel-bundler/parcel/commit/83d4e3b3d7357a1765c2dfc3f802f9ca983ec08b)
- remove call to window.location [Details](https://github.com/parcel-bundler/parcel/commit/6e0a7f678b3938f0c59f0a5f0a77c32b9dd48fb5)

## [1.6.1] - 2018-02-15

### Fixed

- Update HMRServer handleSocketError for ErrorEvent [Details](https://github.com/parcel-bundler/parcel/commit/52aec8a44d26dc1a1b54fc7131668caa374df9d9)

## [1.6.0] - 2018-02-15

### Added

- Automatically transpile dependencies with babel-preset-env [Details](https://github.com/parcel-bundler/parcel/commit/665e6b1b81e279f5efa5840c99c565a6befcf8d5)
- Add no-config support for jsx [Details](https://github.com/parcel-bundler/parcel/commit/5e224bd7f03d71e84512400329542424acf136b5)
- Add "--target=node" and "--target=electron" option to produce Node/electron friendly bundles [Details](https://github.com/parcel-bundler/parcel/commit/420ed63ed18c6a09e8b25754d0142b3b87ebcd71)
- Log bundle metrics [Details](https://github.com/parcel-bundler/parcel/commit/6deec80b3491dc5ac690da6550323b51deec6530)
- Node 6 support [Details](https://github.com/parcel-bundler/parcel/commit/95a6ebfd82ad29a8edb091943950f257320a04c9)
- Add WebManifestAsset to handle W3C webmanifest [Details](https://github.com/parcel-bundler/parcel/commit/1d49e4789a4556455ee43bda23fe903f6966f5b9)
- Add support for optional dependencies [Details](https://github.com/parcel-bundler/parcel/commit/47f252bfea604e1e9090076c573cfd6b0e91a077)
- support svg `<use>` elements [Details](https://github.com/parcel-bundler/parcel/commit/f9be8201130c27e7498b98a5b873e9ac1a7c8e98)
- Auto-install peerDependencies [Details](https://github.com/parcel-bundler/parcel/commit/93315f2b2860b7d3a66ff3af1f3d4ef958f3510e)
- Inject HTML tag if missing [Details](https://github.com/parcel-bundler/parcel/commit/5a3732296f8ca1c6c46fc9f8f3de54f67221fa2d)
- Add JSON5 support [Details](https://github.com/parcel-bundler/parcel/commit/9310641bcd11f891657fb02f2e3acd641153a99b)
- Implement support for `<img srcset="...">` [Details](https://github.com/parcel-bundler/parcel/commit/29ac70b0cdf5174237996dd26d59891a5a543bbf)
- Add `.toml` asset support [Details](https://github.com/parcel-bundler/parcel/commit/55b96406644f9f84b34dab2f98c3a6e5d61c7045)
- Warn instead of error when an fs call cannot be evaluated [Details](https://github.com/parcel-bundler/parcel/commit/6d23efd81bd7e2467fd063c15a5fa5610a568f60)
- Add support for HTML meta assets [Details](https://github.com/parcel-bundler/parcel/commit/c1d8d756cf044dfe0077a92770d31591ba270180)
- Add `--out-file` option [Details](https://github.com/parcel-bundler/parcel/commit/96162771397909367479e0af49c52eb228704a5c)
- Add Access-Control header for CORS [Details](https://github.com/parcel-bundler/parcel/commit/1c761fd5683d9bf195ee5eb6fd04bd494ecb6162)

### Fixed

- Remove `-h` alias for `hmr-port` option [Details](https://github.com/parcel-bundler/parcel/commit/c2022b3ee5d62449bebb03589847c389f0cebda6)
- Add 'id' to the module variable [Details](https://github.com/parcel-bundler/parcel/commit/8d51fdcf650088e586a48babce318354113e974b)
- Preserve asset's search and hash [Details](https://github.com/parcel-bundler/parcel/commit/d7098ce5664c3b04edf291bf96187db8a3434c5b)
- Always add bundle-loader module to the bundle [Details](https://github.com/parcel-bundler/parcel/commit/deba5ef50c5fd630dd7d983b4359b743c4b719a9)
- Launch https websocket server is --https [Details](https://github.com/parcel-bundler/parcel/commit/391e17f60fb4bf5a73ddd352883647fe6541d1cc)
- Fix PromiseQueue returning null when there are no jobs [Details](https://github.com/parcel-bundler/parcel/commit/f27d2695e1a709a7f7fc665c8287c3fa4a0ebec1)
- Correctly serialize YAML to JS [Details](https://github.com/parcel-bundler/parcel/commit/58f89002fc719e0b54216f367ec7e04130412c16)
- Update parser to treat file extensions as case-insensitive [Details](https://github.com/parcel-bundler/parcel/commit/ab713a32a5053c48f83c6503016880369ea65c18)
- Add babel-template and babel-types to package.json [Details](https://github.com/parcel-bundler/parcel/commit/74d70f8467ab131b67f85bf821610234a9c5b1a9)
- Improve Code Coverage [Details](https://github.com/parcel-bundler/parcel/commit/fc641fa7988c8c93fd152d45ef94857fb1662f90)
- Safe cssnano transforms by default [Details](https://github.com/parcel-bundler/parcel/commit/fddfdb907f393991a68ca15e48cf02a600e84840)
- Make sure bundles is an array in loadBundlesLazy [Details](https://github.com/parcel-bundler/parcel/commit/e3fcfa0148d8ccb06577701d91ea066e21842c6e)
- Bump dependencies [Details](https://github.com/parcel-bundler/parcel/commit/13864d17058a2018e083ce1c2688026779a95694)
- Allows for dots in lazyloaded file names [Details](https://github.com/parcel-bundler/parcel/commit/dc4313579b9dffd429b59c880b9fe22ba4d460d7)
- Add missing packages for pnpm to work [Details](https://github.com/parcel-bundler/parcel/commit/d3ae5f69eb3a44b4ca94b36ba2e7033fc69872a3)
- pass lowerCaseAttributeNames: true to posthtml-parser (fix version bump) [Details](https://github.com/parcel-bundler/parcel/commit/1d2f82d2e1b76efe9b806f77fde5dcf1e1b0b063)

## [1.5.1] - 2018-01-25

### Added

- Support .htm extension [Details](https://github.com/parcel-bundler/parcel/commit/3d6709142f702a92b04b065de1d05b211855966b)

### Fixed

- Fix rust projects with hyphenated names [Details](https://github.com/parcel-bundler/parcel/commit/e78baca1d0ffc499fffdd21883df1d43e0ab16f1)
- Purify sourcemaps (Prevent babel from giving invalid mappings) [Details](https://github.com/parcel-bundler/parcel/commit/03291804ec9e73b147548a4e89e6d7079f4595d4)
- Don't drop console statements by default in uglifyjs [Details](https://github.com/parcel-bundler/parcel/commit/8d7339aea1965b929ca8186ce8b617d5c46f218e)
- Fix for ipc closed error in tests [Details](https://github.com/parcel-bundler/parcel/commit/aee8510b7bfb856d7a9b49efd897c7de30cd134c)

## [1.5.0] - 2018-01-23

### Added

- SourceMap support [Details](https://github.com/parcel-bundler/parcel/commit/5c5d5f8af634c0e0aa8e8a3542892febe7c27e85)
- Custom bundleloader and wasm support [Details](https://github.com/parcel-bundler/parcel/commit/244f274f710048682505351fbed777ac7bc49406)
- Rust support [Details](https://github.com/parcel-bundler/parcel/commit/a429c52bb4e53effe586d677d53704a78c8d302b)
- Ability to set HMR port [Details](https://github.com/parcel-bundler/parcel/commit/065a49e8f673922e514c5279d79df74f052a1558)
- Support .env files [Details](https://github.com/parcel-bundler/parcel/commit/50de97fb1239b7079f36c3897fe0c0c5f2e39070)
- Hotreload css requires in html [Details](https://github.com/parcel-bundler/parcel/commit/fb3f9d7a5e120766dd3656ce00b4bb07e76d6af1)
- Minify JSON [Details](https://github.com/parcel-bundler/parcel/commit/c858843bb0e72c6ad46a2349b36843e00b86ea76)
- Ability to set HMR hostname [Details](https://github.com/parcel-bundler/parcel/commit/b56b2a9f3c3ff6db2dd27a086b409a8d4af6f2bd)
- Ability to specify amount of workers using `PARCEL_WORKERS` environment variable [Details](https://github.com/parcel-bundler/parcel/commit/0a2f554080db7f7b3f077e07ac62ade9170d1372)
- Warning emoji [Details](https://github.com/parcel-bundler/parcel/commit/25cf21709a0829131311281cb369d792cf666aa3)

### Fixed

- Virtualpaths, throw file not found error [Details](https://github.com/parcel-bundler/parcel/commit/e09575d495d2ac5282671eab88b827191eee7fa7)
- Transform HTML prior to collecting dependencies [Details](https://github.com/parcel-bundler/parcel/commit/2fbba629eaa83d7de5ccba79e01faa1187393f16)
- Find a[href] dependencies when attrs precede it [Details](https://github.com/parcel-bundler/parcel/commit/39c5cfe377be603b16561f914cb9a07c7e5fdd6c)
- Resolve URI-encoded assets [Details](https://github.com/parcel-bundler/parcel/commit/9770acfb7576572715dd672195180d5fec8156a9)
- Public-url not an os path [Details](https://github.com/parcel-bundler/parcel/commit/a852dd2cd0dc856121ebc2e6cbc2589525a3d435)
- Invalidate cache when parent dependencies change [Details](https://github.com/parcel-bundler/parcel/commit/b8e897341e942b04967a1d44f462375292d5b990)
- Invalidate cache on config change [Details](https://github.com/parcel-bundler/parcel/commit/6c3d34f2215a46dd7845193a6f4036930eaddf48)
- Circular bundles [Details](https://github.com/parcel-bundler/parcel/commit/dd26db34fb70b3e40826bf3c4878172eb60afe91)
- Possibly ignore fs using browser-resolve config [Details](https://github.com/parcel-bundler/parcel/commit/bd9fd9f6193c3f18efa03f897a33906869808b96)
- Do not use global window inside hmr, fixes web worker issues [Details](https://github.com/parcel-bundler/parcel/commit/6962a9a96cdedafbf27715bc74b93e6c8ad7eb19)
- Improved worker startup times [Details](https://github.com/parcel-bundler/parcel/commit/072d799d48bb3639c628687937f3641fe2cff74d)
- Parse `//` as a valid url [Details](https://github.com/parcel-bundler/parcel/commit/a78280affa7e02cb142e51259ea4076ed036600a)
- Improve windows emoji console detections [Details](https://github.com/parcel-bundler/parcel/commit/dba3d49be2d30dfe47a9bd9c88d6fba9015be968)

## [1.4.1] - 2017-12-31

### Added

- Changelog [Details](https://github.com/parcel-bundler/parcel/commit/dc4acd8efebf76116b9e06e89827e56cfa217013)

### Fixed

- http hot reload server printing location as `https://...` [Details](https://github.com/parcel-bundler/parcel/commit/0fcdeb9a9feac10be3ff2485e2487588734a6754)
- Execute bundle() when calling Bundler.middleware() [Details](https://github.com/parcel-bundler/parcel/commit/b9004fc3a0092cdfa0b18e196ab25a79e582b2d1)
- Always parse dependencies if babel ran. [Details](https://github.com/parcel-bundler/parcel/commit/c6991116f0759b865f1a55336c32ba0793fa09c3)

## [1.4.0] - 2017-12-31

### Added

- HTTPS server support [Details](https://github.com/parcel-bundler/parcel/commit/90b968432592f38ecca0ad3b2cb5f7fbfbcd684c)
- GraphQL Support [Details](https://github.com/parcel-bundler/parcel/commit/8f1f497945d4e5102c401e3036c4bc30fd692348)
- Webworker Support [Details](https://github.com/parcel-bundler/parcel/commit/c8a1156d4c2dd5902ba500aa9c25547bfab53eac)
- CSSNano configuration [Details](https://github.com/parcel-bundler/parcel/commit/14e7880be2a147503999e21d4c1114874cc500d7)
- HTMLNano configuration [Details](https://github.com/parcel-bundler/parcel/commit/d11a15e1636ea7c7f291d0cfbf73b75cc719e839)
- Support async plugin loading [Details](https://github.com/parcel-bundler/parcel/commit/bb6e6044b7569fd6745ab915dfd49327d0cbb955)
- Add code sample section to `ISSUE_TEMPLATE` [Details](https://github.com/parcel-bundler/parcel/commit/8a65676023f88a53372ab4bf0b6daada49de6b49)
- Add url dependency for serviceWorker.register calls [Details](https://github.com/parcel-bundler/parcel/commit/0ab0acaecece829392cd452f83014df7c470fc83)
- Fix ignored babel files [Details](https://github.com/parcel-bundler/parcel/commit/22478d368216b24da3bd3e94439b02e356fd4310)

### Fixed

- log-symbols fallback for cross-platform emoji compatibility [Details](https://github.com/parcel-bundler/parcel/commit/0eb4487491fd70390697ad413aeac994fca4309c)
- Use hostname for websocket connection [Details](https://github.com/parcel-bundler/parcel/commit/06d5ffc33dac19fa9ca730bbf939052b500a34ec)
- Standardize empty implementation comment [Details](https://github.com/parcel-bundler/parcel/commit/d763a1aaca70a7892cb4c6611c2540ca1506d107)
- Handle appstore url scheme [Details](https://github.com/parcel-bundler/parcel/commit/494fafc33ec0a3c66b423670a24539896015855f)
- bundling issues when asset parent & commonBundle types differ [Details](https://github.com/parcel-bundler/parcel/commit/127c9b72d20847734049a7db27683279c6784ab6)
- Handle empty assets [Details](https://github.com/parcel-bundler/parcel/commit/4c67f03808dca6cf9b9a47bcd92477e09005da75)
- Minify `Prelude.js` [Details](https://github.com/parcel-bundler/parcel/commit/a0ede06395807cc0f7f6caad7aee2cb1463d41ac)

## [1.3.1] - 2017-12-24

### Fixed

- Maintain html spacing between tags when minimizing [Details](https://github.com/parcel-bundler/parcel/commit/0f40da9bd4249b43d22597f80d0306791e9203f6)
- Incorrect bundle path for raw Assets [Details](https://github.com/parcel-bundler/parcel/commit/38f8aaf173a8ff501ddd02741969089576b42bd6)

## [1.3.0] - 2017-12-22

### Added

- Reason Asset Type [Details](https://github.com/parcel-bundler/parcel/commit/47e91926f1d9ed763ad11cbd39a9b9fbc1986b20)
- Automatically install parser dependencies [Details](https://github.com/parcel-bundler/parcel/commit/6f493f030852f557c299b2c26a565c99e1e9de66)
- UglifyES config support [Details](https://github.com/parcel-bundler/parcel/commit/1947a15d40cc2b7dd91bdc64d02a5d79604ba550)
- Display absolute path on failed dependency resolve [Details](https://github.com/parcel-bundler/parcel/commit/dffeb7d81ea14e9739b372132fd32d8d74d9b368)
- Support `.editorconfig` [Details](https://github.com/parcel-bundler/parcel/commit/6c96b6588afc1b774551c5eda3487c2d0fab6dc0)
- Tests for ES6 Modules resolver [Details](https://github.com/parcel-bundler/parcel/commit/76186779b2a24ce1befc7c5d5b3e783c7b9f5c94)
- ESLint [Details](https://github.com/parcel-bundler/parcel/commit/434b86c92b19e2c7de13a121600d0533c1138169)

### Fixed

- Parse port option as integer [Details](https://github.com/parcel-bundler/parcel/commit/1fa9fef1d1165630b0beabba5d546ee3ccffbec1)
- Make cli.js Node 6 compatible [Details](https://github.com/parcel-bundler/parcel/commit/ac0fbaf40b9cc93b3f428c2b6c124027f56e6e78)
- Remove arrow function from hmr-runtime - IE support [Details](https://github.com/parcel-bundler/parcel/commit/9f5b334d6e04136d93ae428a5eef899371b400e0)
- Start server before bundling [Details](https://github.com/parcel-bundler/parcel/commit/44d0bd6633b71ce3b36b4faeee514182dcc9334a)
- Deterministic bundle trees [Details](https://github.com/parcel-bundler/parcel/commit/539ade1820c3e644586e3161f6b2357a68784142)
- Resolve "module", "jsnext:main" and "browser" before "main" in Package.json [Details](https://github.com/parcel-bundler/parcel/commit/7fcae064b205ab30c2393c3ce68171fd9f47ffc1)
- Remove filename unsafe characters [Details](https://github.com/parcel-bundler/parcel/commit/df021967900fd60d7a58a79191daa26caf68c2b5)
- Don't hash root file [Details](https://github.com/parcel-bundler/parcel/commit/075190c9868c5dd01ec4a935a187e21ae00662e5)
- Use cross-spawn for autoinstalling dependencies on windows [Details](https://github.com/parcel-bundler/parcel/commit/ab3a7d61a4f3e19b129583914fb9fad4c54d8dc6)

## [1.2.1] - 2017-12-18

### Added

- Opencollective [Details](https://github.com/parcel-bundler/parcel/commit/0f554dc2f5c8f2557ec84eee5301b90ffb279764)
- Use `JSON5` to parse config files [Details](https://github.com/parcel-bundler/parcel/commit/bd458660ce38e7a1d25bd9758084acc24418e054)
- Move JSAsset options gathering into seperate function [Details](https://github.com/parcel-bundler/parcel/commit/333c3aa5d20f98a5f3c52635751032d12854c13c)

### Fixed

- Don't use template literals in builtins - IE support [Details](https://github.com/parcel-bundler/parcel/commit/b7b2991d69b960d9f2951828b8145a6d9396ee4e)
- Merge `tsconfig.json` with defaults [Details](https://github.com/parcel-bundler/parcel/commit/86835793a513b43af906a02083eed72b7eb9e0d2)
- Change `parse-json` requires to `JSON5` [Details](https://github.com/parcel-bundler/parcel/commit/ed35a0994d34dfead6b8895ae981d9b05edac361)
- Register `.pcss` extension to CSSAsset [Details](https://github.com/parcel-bundler/parcel/commit/f62d47686698807e43923893affb6f4ce22337ac)
- Websocket error handling [Details](https://github.com/parcel-bundler/parcel/commit/9f27e15bfcefc2e629a97c154ec2391e2a962623)
- Development server index file [Details](https://github.com/parcel-bundler/parcel/commit/c008bb0ac492dbac38e2f13017e3143f40359934)

## [1.2.0] - 2017-12-12

### Added

- Coffeescript support [Details](https://github.com/parcel-bundler/parcel/commit/2d680c0e968cbdda46455ae792b4dbac33dc9753)
- Reload html on change [Details](https://github.com/parcel-bundler/parcel/commit/0ff76bea36135a4b1edbd85a588a4e26c86dcc19)
- `--open` option to automatically launch in default browser [Details](https://github.com/parcel-bundler/parcel/commit/f8b3d55288f4c4a15330daf7d950cc496fde47ed)
- Prettier [Details](https://github.com/parcel-bundler/parcel/commit/548eef92e11711db007b7613ba5530de508d21a0)
- Code of conduct [Details](https://github.com/parcel-bundler/parcel/commit/72c4d47a77d0b4419d54130e2ea2f39ae40b74da)
- User friendly server errors and automatic port switching [Details](https://github.com/parcel-bundler/parcel/commit/87350f44223ea77597f5d2f50c3886ebd6126a42)
- Version option to command description [Details](https://github.com/parcel-bundler/parcel/commit/35c65a34ac41508c3a3bed8944bb478cebc3e071)
- Add badges to readme [Details](https://github.com/parcel-bundler/parcel/commit/644f195341c1a47d49af101716ce2fa8b323a0fe)
- Support JSON comments [Details](https://github.com/parcel-bundler/parcel/commit/7bfe232ba1db4f27278025175cf3818fbc34e65f)
- Add AppVeyor CI [Details](https://github.com/parcel-bundler/parcel/commit/0eb7a930ffcd4fc77b5b6c75e490299f92ca8a8e)
- Use `UglifyES` instead of `UglifyJS` [Details](https://github.com/parcel-bundler/parcel/commit/70663cced00e5f98d3e8e3affbc0ee40a9ab4566)

### Fixed

- Bundle-loader when using esModule [Details](https://github.com/parcel-bundler/parcel/commit/7d1f384122431b90e715161e50a5abf39dc8fd9d)
- Use var over let in builtins for IE support [Details](https://github.com/parcel-bundler/parcel/commit/29515f4f713b093bad9cf8fedd796c4eacb4f38b)
- Add jsm to javascript extensions [Details](https://github.com/parcel-bundler/parcel/commit/cdda0442cc9a00dde5f54ffc643a32e58390034f)
- Log pluginload errors [Details](https://github.com/parcel-bundler/parcel/commit/acdf9792ed53a5909cc5ab638ad0f27403b41957)
- Global env problem [Details](https://github.com/parcel-bundler/parcel/commit/355c63bc956bf24dd7d040e52dd3be2fda47ad9c)
- Exit on build error when using build command [Details](https://github.com/parcel-bundler/parcel/commit/34b84e44573fd583689ccefde5a8bd9f46de203b)
- Remove circular require in Asset.js [Details](https://github.com/parcel-bundler/parcel/commit/7c0acb32bc7374a294f53d758e330c52966919dd)
- Give high priotity to extension of parent [Details](https://github.com/parcel-bundler/parcel/commit/2e3266242f7f2dd01fd21c3ba58d0fb575635e43)
- Fallback to `os.cpus()` for cpu count [Details](https://github.com/parcel-bundler/parcel/commit/9d319afd7683468361dc2f04b253aaca38e779ee)
- Windows test issues [Details](https://github.com/parcel-bundler/parcel/commit/0eb7a930ffcd4fc77b5b6c75e490299f92ca8a8e)
- Raw Asset loading [Details](https://github.com/parcel-bundler/parcel/commit/51b90d7458fca5b10dbaa0605c33223b8884b6e1)
- Normalize path on windows [Details](https://github.com/parcel-bundler/parcel/commit/0479dee763fc9d79c057c86233cb660c6022a92c)
- Make hmr-runtime ES3 compatible [Details](https://github.com/parcel-bundler/parcel/commit/d17dccccf4480e440c1898911f304efe6040439f)
- Dynamically importing js assets with raw assets children [Details](https://github.com/parcel-bundler/parcel/commit/dc52638a27d41b1eadf25ecc5d93bfe6727182c7)
- Package.json loading issues for plugin loading [Details](https://github.com/parcel-bundler/parcel/commit/7469a150bf5accecdcfc430365572601527302b9)

## [1.1.0] - 2017-12-08

### Added

- Typescript support [Details](https://github.com/parcel-bundler/parcel/commit/757b67362e1fce076241fa31afe2179db93cff18)
- Browser gets notified of errors [Details](https://github.com/parcel-bundler/parcel/commit/d9d8bab2a9bcd2efd23bd824d4c24af1d66a3f77)
- Community section to Readme [Details](https://github.com/parcel-bundler/parcel/commit/11d109b4b4e03f8ab5da253f9c70b0e6e11e8f3b)
- More helpfull json parsing error messages using `parse-json` [Details](https://github.com/parcel-bundler/parcel/commit/2b26f9691d3dc489c509476718fa852b231ffde1)
- Issue template [Details](https://github.com/parcel-bundler/parcel/commit/f8dd2f2aea167f011a5c885b20390521798c8c9f)

### Fixed

- Print stack traces on error [Details](https://github.com/parcel-bundler/parcel/commit/4ab9b878a2b1ea280afaac690fb0990947c4323e)
- Merge `postcss-modules` config [Details](https://github.com/parcel-bundler/parcel/commit/582f8db1f735ecbbd4f5c93202ba0f6a6c24f8ca)
- Default to `NODE_ENV` development on serve [Details](https://github.com/parcel-bundler/parcel/commit/29f8df78788061a7f406059bc55c8ede428a020d)
- Disable flakey macOS FS events in watcher in the tests [Details](https://github.com/parcel-bundler/parcel/commit/e69c83d9db38fac8d1e525bdf03a883b551f506d)
- Sort child bundles by asset names to avoid race condition in tests [Details](https://github.com/parcel-bundler/parcel/commit/c49e43a5a6f4b602d07f72f76b8443bf37203a3f)

## [1.0.3] - 2017-12-07

### Added

- Add version to cache key [Details](https://github.com/parcel-bundler/parcel/commit/f3287ab76f5921d1ec7273bee42871179fe3ca85)
- Travis tests environment, build script and contribution docs [Details](https://github.com/parcel-bundler/parcel/commit/90f69ff30b9b239b537ca1b01f8ce7fb1d08ce6a)

### Fixed

- File url bugfix for Firefox [Details](https://github.com/parcel-bundler/parcel/commit/90a5373d629bebdc9761ddb784e683190bdcc35a#diff-78cb52acd60299e5f6fd26a716d97293)
- Windows path bugfix [Details](https://github.com/parcel-bundler/parcel/commit/67cd3b0678b835f3a21134800bc0f9c9b8d599e2)
- Default only exports [Details](https://github.com/parcel-bundler/parcel/commit/860a748898f8a0fee749aec2e6bdc3eaabf0ce87)
- Public URL in normalizeOptions [Details](https://github.com/parcel-bundler/parcel/commit/9b066122ed40afc05f5eb20ea0cc1ec9e748592b)
- Do not try to import data:, tel:, mailto:, something: URLS [Details](https://github.com/parcel-bundler/parcel/commit/781b7ecd114edd63fe6ad04dfc1408c9a611f2f5)

## [1.0.2] - 2017-12-06

### Added

- Add github repository to `package.json` [Details](https://github.com/parcel-bundler/parcel/commit/88bdf1e474d8bc8af3f770b431d011239f1ede14)

### Fixed

- Improved public url checking using `is-url` instead of regex [Details](https://github.com/parcel-bundler/parcel/commit/92be140ad55fcdef7b34baa6718bc356274e5e8f)

### Removed

- `babel-preset-es2015` removed from dev dependencies [Details](https://github.com/parcel-bundler/parcel/commit/4d87814f7201d70cfa5db3b457915c508378c9e6)

## [1.0.1] - 2017-12-05

- Initial Parcel-bundler core
