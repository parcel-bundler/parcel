/* eslint-disable */

require('@parcel/babel-register');
const {parcel, hashString} = require('@parcel/rust');
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
const BundleGraph = require('@parcel/core/src/BundleGraph').default;
const {ContentGraph} = require('@parcel/graph/src');
const {createAssetIdFromOptions} = require('@parcel/core/src/assetUtils');
const {getPublicId} = require('@parcel/core/src/utils');
const MutableBundleGraph = require('@parcel/core/src/public/MutableBundleGraph').default;
const {TargetResolver} = require('@parcel/core/src/requests/TargetRequest');

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
    case 'Target': {
      let targetResolver = new TargetResolver({
        invalidateOnFileCreate() {},
        invalidateOnFileUpdate() {},
        invalidateOnFileDelete() {}
      }, options);
      let targets = await targetResolver.resolve(request.entry.filePath, request.entry.target);
      return {
        type: 'Target',
        value: targets.map(t => ({
          ...t,
          env: {
            ...t.env,
            flags: 0
          }
        }))
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
}).then(async (serializedGraph) => {
  console.timeEnd('build');
  // console.log(serializedGraph)

  let graph = new ContentGraph();
  let publicIdByAssetId = new Map();
  let assetPublicIds = new Set();
  for (let node of serializedGraph.nodes) {
    // TODO
    let id = node.type === 'asset' ? createAssetIdFromOptions(node.value) : node.type === 'dependency' ? dependencyId(node.value) : '@@root';
    let index = graph.addNodeByContentKey(id, {
      id,
      type: node.type,
      value: {
        ...node.value,
        id,
      }
    });

    if (node.type === 'root') {
      graph.setRootNodeId(index);
    }
    // console.log(node)

    if (node.type === 'asset') {
      let publicId = publicIdByAssetId.get(id);
      if (publicId == null) {
        publicId = getPublicId(id, existing =>
          assetPublicIds.has(existing),
        );
        publicIdByAssetId.set(id, publicId);
        assetPublicIds.add(publicId);
      }
    }
  }

  for (let i = 0; i < serializedGraph.edges.length; i += 2) {
    let from = serializedGraph.edges[i];
    let to = serializedGraph.edges[i + 1];
    graph.addEdge(from, to);
  }

  let bundleGraph = new BundleGraph({
    graph,
    assetPublicIds,
    bundleContentHashes: new Map(),
    publicIdByAssetId,
  });
  let mutableBundleGraph = new MutableBundleGraph(
    bundleGraph,
    options,
  );

  const {plugin: bundler} = await loadPlugin('@parcel/bundler-default', __dirname, null, options);
  let config = undefined;

  if (bundler.loadConfig) {
    config = createConfig({
      plugin: '@parcel/bundler-default',
      searchPath: 'index',
    });

    config.result = await bundler.loadConfig({
      config: new PublicConfig(config, options),
      options: new PluginOptions(options),
      logger: new PluginLogger({origin: '@parcel/bundler-default'}),
      tracer: undefined // TODO
    });
  }

  await bundler.bundle({
    bundleGraph: mutableBundleGraph,
    // config: this.configs.get(plugin.name)?.result,
    config: config?.result,
    options: new PluginOptions(options),
    logger: new PluginLogger({origin: '@parcel/bundler-default'}),
    // tracer,
  });

  console.log(bundleGraph.getBundles())
});

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

function dependencyId(opts) {
  return hashString(
    (opts.sourcePath ?? '') +
      opts.specifier +
      JSON.stringify(opts.env) +
      (opts.target ? JSON.stringify(opts.target) : '') +
      (opts.pipeline ?? '') +
      opts.specifierType +
      (opts.bundleBehavior ?? '') +
      (opts.priority ?? 'sync') +
      (opts.packageConditions ? JSON.stringify(opts.packageConditions) : ''),
  )
}