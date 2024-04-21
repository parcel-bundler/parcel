/* eslint-disable */

require('@parcel/babel-register');
const {parcel} = require('@parcel/rust');
const {EntryResolver} = require('@parcel/core/src/requests/EntryRequest');
const {NodeFS} = require('@parcel/fs/src');
const {FSCache} = require('@parcel/cache/src');
const {NodePackageManager} = require('@parcel/package-manager/src');
const {fromProjectPath} = require('@parcel/core/src/projectPath');
const {loadParcelConfig} = require('@parcel/core/src/requests/ParcelConfigRequest');
const loadPlugin = require('@parcel/core/src/loadParcelPlugin').default;
const {Asset, MutableAsset} = require('@parcel/core/src/public/Asset');
const UncommittedAsset = require('@parcel/core/src/UncommittedAsset').default;
const PluginOptions = require('@parcel/core/src/public/PluginOptions').default;
const {PluginLogger} = require('@parcel/logger/src/Logger');
const {createConfig} = require('@parcel/core/src/InternalConfig');
const PublicConfig = require('@parcel/core/src/public/Config').default;

const fs = new NodeFS();
const cache = new FSCache(fs, __dirname + '/.parcel-cache');

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
  defaultConfig: require.resolve('@parcel/config-default')
};

// console.log(parcel);

console.time('build');
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
    case 'ParcelConfig': {
      let {config} = await loadParcelConfig(options);
      return {
        type: 'ParcelConfig',
        value: config
      };
    }
    case 'Transform': {
      try {
        let {plugin} = await loadPlugin(request.plugin.packageName, fromProjectPath(options.projectRoot, request.plugin.resolveFrom), request.plugin.keyPath, options);
        let result = await runTransformer(request.plugin.packageName, plugin, request.asset, request.code);
        return {
          type: 'Transform',
          value: result
        };

      } catch (err) {
        console.log(err)
      }
    }
  }
}).then(() => console.timeEnd('build'));

async function runTransformer(transformerName, transformer, asset, content) {
  asset.dependencies = new Map();
  let uncommittedAsset = new UncommittedAsset({
    value: asset,
    options,
    content
  });

  // TODO: some fields have a different representation in Rust. Will need new public wrappers.
  let publicAsset = new Asset(uncommittedAsset);
  let mutableAsset = new MutableAsset(uncommittedAsset);
  let pluginOptions = new PluginOptions(options);
  let logger = new PluginLogger({origin: transformerName});
  let config = undefined;

  if (transformer.loadConfig) {
    config = createConfig({
      plugin: transformerName,
      isSource: false, // TODO
      searchPath: asset.filePath,
      env: asset.env
    });

    config.result = await transformer.loadConfig({
      config: new PublicConfig(config, options),
      options: pluginOptions,
      logger,
      tracer: undefined // TODO
    });
  }

  if (transformer.parse) {
    let ast = await transformer.parse({
      asset: publicAsset,
      config: config?.result,
      options: pluginOptions,
      resolve: undefined,
      logger,
      tracer: undefined // TODO
    });
    if (ast) {
      uncommittedAsset.setAST(ast);
      uncommittedAsset.isASTDirty = false;
    }
  }

  let results = await transformer.transform({
    asset: mutableAsset,
    config: config?.result,
    options: pluginOptions,
    resolve: undefined, // TODO
    logger,
    tracer: undefined // TODO
  });

  let resultAsset = results[0]; // TODO: support multiple

  if (transformer.generate && uncommittedAsset.ast) {
    let output = transformer.generate({
      asset: publicAsset,
      ast: uncommittedAsset.ast,
      options: pluginOptions,
      logger,
      tracer: undefined,
    });
    uncommittedAsset.content = output.content;
    uncommittedAsset.mapBuffer = output.map?.toBuffer();
    uncommittedAsset.clearAST();
  }

  // TODO: postProcess??

  if (resultAsset === mutableAsset) {
    return {
      asset,
      dependencies: Array.from(asset.dependencies.values()),
      code: await uncommittedAsset.getBuffer()
    };
  } else {
    // TODO
  }
}
