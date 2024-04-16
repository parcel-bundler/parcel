/* eslint-disable */

require('@parcel/babel-register');
const {parcel} = require('@parcel/rust');
const {EntryResolver} = require('@parcel/core/src/requests/EntryRequest');
const {NodeFS} = require('@parcel/fs/src');
const {FSCache} = require('@parcel/cache/src');
const {NodePackageManager} = require('@parcel/package-manager/src');
const {fromProjectPath} = require('@parcel/core/src/projectPath');

const fs = new NodeFS();
const cache = new FSCache();

const options = {
  cacheDir: __dirname + '/.parcel-cache',
  watchDir: __dirname,
  watchIgnore: undefined,
  watchBackend: undefined,
  entries: [],
  logLevel: 'info',
  targets: undefined,
  projectRoot: __dirname,
  shouldAutoInstall: false,
  hmrOptions: undefined,
  shouldContentHash: true,
  shouldBuildLazily: false,
  lazyIncludes: [],
  lazyExcludes: [],
  shouldBundleIncrementally: true,
  serveOptions: false,
  mode: 'development',
  env: {},
  shouldDisableCache: false,
  shouldProfile: false,
  shouldTrace: false,
  inputFS: fs,
  outputFS: fs,
  cache,
  shouldPatchConsole: false,
  packageManager: new NodePackageManager(fs, '/'),
  additionalReporters: [],
  instanceId: 'test',
  defaultTargetOptions: {
    shouldScopeHoist: false,
    shouldOptimize: false,
    publicUrl: '/',
    distDir: undefined,
    sourceMaps: false,
  },
  featureFlags: {
    exampleFeature: false,
    configKeyInvalidation: false,
  },
};

// console.log(parcel);

parcel(['/Users/devongovett/Downloads/bundler-benchmark/cases/all/src/index.js'], async (err, request) => {
  switch (request.type) {
    case 'Entry': {
      let entryResolver = new EntryResolver(options);
      let result = await entryResolver.resolveEntry(request.entry);
      return {
        type: 'Entry',
        value: result.entries.map(e => ({
          // For now convert project paths to absolute.
          // TODO: use project paths in rust
          filePath: fromProjectPath(options.projectRoot, e.filePath),
          packagePath: fromProjectPath(options.projectRoot, e.packagePath),
          target: e.target,
          loc: e.loc
        }))
      }
    }
  }
});
