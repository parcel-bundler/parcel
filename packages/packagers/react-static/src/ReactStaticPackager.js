// @flow
import type {
  Asset,
  Async,
  Blob,
  BundleGraph,
  Dependency,
  NamedBundle,
  Meta,
} from '@parcel/types';
import {blobToString, PromiseQueue, urlJoin} from '@parcel/utils';
import fs from 'fs';
import Module from 'module';
import {Packager} from '@parcel/plugin';
import path from 'path';
import {ResolverBase} from '@parcel/node-resolver-core';
import vm from 'vm';
import nullthrows from 'nullthrows';
import {Readable} from 'stream';
import {hashString} from '@parcel/rust';
// $FlowFixMe
import {AsyncLocalStorage} from 'node:async_hooks';

export interface Page {
  url: string;
  name: string;
}

export interface PageProps {
  pages: Page[];
  currentPage: Page;
}

interface ParcelModule {
  exports: any;
  children: ParcelModule[];
  filename: string;
  id: string;
  path: string;
}

let clientResolver: ResolverBase;
let serverResolver: ResolverBase;
let packagingBundles = new Map<NamedBundle, Async<{|contents: Blob|}>>();
let moduleCache = new Map<string, ParcelModule>();
let loadedBundles = new Map<NamedBundle, any>();
let context: any = vm.createContext();
let bundleLookupCache = new WeakMap();

export default (new Packager({
  async loadConfig({options, config}) {
    config.invalidateOnBuild();
    packagingBundles.clear();
    moduleCache.clear();
    loadedBundles.clear();
    context = createContext(options);
    clientResolver = new ResolverBase(options.projectRoot, {
      mode: 2,
      packageExports: true,
    });

    serverResolver = new ResolverBase(options.projectRoot, {
      mode: 2,
      packageExports: true,
      conditions: 1 << 16, // "react-server"
    });

    // This logic must be synced with the packager...
    let packageName = await config.getConfigFrom(
      options.projectRoot + '/index',
      [],
      {
        packageKey: 'name',
      },
    );

    let name = packageName?.contents ?? '';
    return {
      parcelRequireName: 'parcelRequire' + hashString(name).slice(-4),
    };
  },
  loadBundleConfig({bundle, bundleGraph}) {
    let pages: Page[] = [];
    for (let b of bundleGraph.getEntryBundles()) {
      let main = b.getMainEntry();
      if (main && b.type === 'js' && b.needsStableName) {
        let meta = pageMeta(main.meta);
        pages.push({
          url: urlJoin(b.target.publicUrl, b.name),
          name: b.name,
          ...meta,
        });
      }
    }

    let referencedBundles = [];
    for (let b of bundleGraph.getReferencedBundles(bundle, {
      includeInline: false,
      includeIsolated: false,
    })) {
      referencedBundles.push(b.getContentHash());
    }

    return {pages, referencedBundles};
  },
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    config,
    bundleConfig,
  }) {
    if (bundle.env.shouldScopeHoist) {
      throw new Error('Scope hoisting is not supported with SSG');
    }

    let {load, loadModule} = await loadBundle(
      bundle,
      bundleGraph,
      getInlineBundleContents,
    );

    let Component = load(nullthrows(bundle.getMainEntry()).id).default;
    let {renderToReadableStream} = loadModule(
      'react-server-dom-parcel/server.edge',
      __filename,
      'react-server',
    );
    let {prerender} = loadModule(
      'react-dom/static.edge',
      __filename,
      'react-client',
    );
    let React = loadModule('react', __filename, 'react-client');
    let {createFromReadableStream} = loadModule(
      'react-server-dom-parcel/client.edge',
      __filename,
      'react-client',
    );
    let {injectRSCPayload} = await import('rsc-html-stream/server');

    let pages: Page[] = bundleConfig.pages;
    let meta = pageMeta(nullthrows(bundle.getMainEntry()).meta);
    let props: PageProps = {
      key: 'page',
      pages,
      currentPage: {
        url: urlJoin(bundle.target.publicUrl, bundle.name),
        name: bundle.name,
        ...meta,
      },
    };

    let resources = [];
    let bootstrapModules = [];
    let entry;
    for (let b of bundleGraph.getReferencedBundles(bundle, {
      includeInline: false,
      includeIsolated: false,
    })) {
      if (b.type === 'css') {
        resources.push(
          React.createElement('link', {
            key: b.id,
            rel: 'stylesheet',
            href: urlJoin(b.target.publicUrl, b.name),
            precedence: 'default',
          }),
        );
      } else if (b.type === 'js' && b.env.isBrowser()) {
        bootstrapModules.push(urlJoin(b.target.publicUrl, b.name));
        resources.push(
          React.createElement('script', {
            key: b.id,
            type: 'module',
            async: true,
            src: urlJoin(b.target.publicUrl, b.name),
          }),
        );

        if (!entry) {
          b.traverseAssets((a, ctx, actions) => {
            if (
              Array.isArray(a.meta.directives) &&
              a.meta.directives.includes('use client-entry')
            ) {
              entry = a;
              actions.stop();
            }
          });
        }
      }
    }

    let stream = renderToReadableStream([
      ...resources,
      React.createElement(Component, props),
    ]);
    let [s1, renderStream] = stream.tee();
    let [injectStream, rscStream] = s1.tee();
    let data;
    function Content() {
      data ??= createFromReadableStream(renderStream);
      return React.use(data);
    }

    let bootstrapScriptContent;
    if (entry) {
      bootstrapScriptContent = `Promise.all([${bootstrapModules
        .map(m => `import("${m}")`)
        .join(',')}]).then(()=>${
        nullthrows(config).parcelRequireName
      }(${JSON.stringify(bundleGraph.getAssetPublicId(entry))}))`;
    }

    let {prelude} = await prerender(React.createElement(Content), {
      bootstrapScriptContent,
    });

    // Buffer into a single chunk so hash reference replacement works correctly.
    // There could potentially be a more optimal way of doing this in the future.
    let buffers = [];
    let len = 0;
    // $FlowFixMe
    let bufferedStream = new TransformStream({
      transform(chunk) {
        len += chunk.length;
        buffers.push(chunk);
      },
      flush(controller) {
        let concated = new Uint8Array(len);
        let offset = 0;
        for (let buf of buffers) {
          concated.set(buf, offset);
          offset += buf.length;
        }
        controller.enqueue(concated);
      },
    });

    let response = prelude.pipeThrough(
      injectRSCPayload(injectStream.pipeThrough(bufferedStream)),
    );

    return [
      {
        type: 'html',
        contents: Readable.from(response),
      },
      {
        type: 'rsc',
        contents: Readable.from(rscStream),
      },
    ];
  },
}): Packager);

function loadBundle(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  getInlineBundleContents: (
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
  ) => Async<{|contents: Blob|}>,
) {
  let cached = loadedBundles.get(bundle);
  if (!cached) {
    cached = loadBundleUncached(bundle, bundleGraph, getInlineBundleContents);
    loadedBundles.set(bundle, cached);
  }

  return cached;
}

async function loadBundleUncached(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  getInlineBundleContents: (
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
  ) => Async<{|contents: Blob|}>,
) {
  // Load all asset contents.
  let queue = new PromiseQueue<Array<[string, [NamedBundle, Asset, string]]>>({
    maxConcurrent: 32,
  });
  bundle.traverse(node => {
    if (node.type === 'dependency') {
      let dep = node.value;
      let entryBundle = bundleGraph.getReferencedBundle(dep, bundle);
      if (entryBundle?.bundleBehavior === 'inline') {
        queue.add(async () => {
          if (!packagingBundles.has(entryBundle)) {
            packagingBundles.set(
              entryBundle,
              getInlineBundleContents(entryBundle, bundleGraph),
            );
          }

          let packagedBundle = await nullthrows(
            packagingBundles.get(entryBundle),
          );
          let contents = await blobToString(packagedBundle.contents);
          contents = `module.exports = ${contents}`;
          return [
            [
              entryBundle.id,
              [entryBundle, nullthrows(entryBundle.getMainEntry()), contents],
            ],
          ];
        });
      } else if (entryBundle) {
        queue.add(async () => {
          let {assets: subAssets} = await loadBundle(
            entryBundle,
            bundleGraph,
            getInlineBundleContents,
          );
          return Array.from(subAssets);
        });
      }
    } else if (node.type === 'asset') {
      let asset = node.value;
      queue.add(async () => [
        [asset.id, [bundle, asset, await asset.getCode()]],
      ]);
    }
  });

  for (let b of bundleGraph.getReferencedBundles(bundle)) {
    queue.add(async () => {
      let {assets: subAssets} = await loadBundle(
        b,
        bundleGraph,
        getInlineBundleContents,
      );
      return Array.from(subAssets);
    });
  }

  let assets = new Map<string, [NamedBundle, Asset, string]>(
    (await queue.run()).flatMap(v => v),
  );
  let assetsByFilePath = new Map<string, string>();
  let assetsByPublicId = new Map<string, string>();
  for (let [, asset] of assets.values()) {
    assetsByFilePath.set(getCacheKey(asset), asset.id);
    assetsByPublicId.set(bundleGraph.getAssetPublicId(asset), asset.id);
  }

  // Load an asset into the module system by id.
  let loadAsset = (id: string) => {
    let [bundle, asset, code] = nullthrows(assets.get(id));
    let cacheKey = getCacheKey(asset);
    let cachedModule = moduleCache.get(cacheKey);
    if (cachedModule) {
      return cachedModule.exports;
    }

    // Build a mapping of dependencies to their resolved assets.
    let deps = new Map();
    for (let dep of bundleGraph.getDependencies(asset)) {
      if (bundleGraph.isDependencySkipped(dep)) {
        deps.set(getSpecifier(dep), {skipped: true});
        continue;
      }

      let entryBundle = bundleGraph.getReferencedBundle(dep, bundle);
      if (entryBundle?.bundleBehavior === 'inline') {
        deps.set(getSpecifier(dep), {id: entryBundle.id});
        continue;
      }

      let resolved = bundleGraph.getResolvedAsset(dep, bundle);
      if (resolved) {
        if (resolved.type !== 'js') {
          deps.set(getSpecifier(dep), {skipped: true});
        } else {
          let resolution = {id: resolved.id};

          // Dependencies may be re-targeted to follow re-exports.
          for (let [name, sym] of dep.symbols) {
            let rewritten = sym.meta?.rewritten;
            if (typeof rewritten === 'string') {
              if (Array.isArray(resolution)) {
                resolution.push([rewritten, resolved.id, name]);
              } else {
                resolution = [[rewritten, resolved.id, name]];
              }
            }
          }

          let specifier = getSpecifier(dep);
          let cur = deps.get(specifier);
          if (Array.isArray(cur) && Array.isArray(resolution)) {
            cur.push(...resolution);
          } else {
            deps.set(specifier, resolution);
          }
        }
      } else {
        deps.set(getSpecifier(dep), {specifier: dep.specifier});
      }
    }

    let defaultRequire = Module.createRequire(asset.filePath);
    let require = (id: string) => {
      let resolution = deps.get(id);
      if (resolution?.skipped) {
        return {};
      }

      // Synthesize a module to follow re-exports.
      if (Array.isArray(resolution)) {
        var m = {__esModule: true};
        resolution.forEach(function (v) {
          var key = v[0];
          var id = v[1];
          var exp = v[2];
          var x = loadAsset(id);
          if (key === '*') {
            Object.keys(x).forEach(function (key) {
              if (
                key === 'default' ||
                key === '__esModule' ||
                // $FlowFixMe
                Object.prototype.hasOwnProperty.call(m, key)
              ) {
                return;
              }

              Object.defineProperty(m, key, {
                enumerable: true,
                get: function () {
                  return x[key];
                },
              });
            });
          } else if (exp === '*') {
            Object.defineProperty(m, key, {
              enumerable: true,
              value: x,
            });
          } else {
            Object.defineProperty(m, key, {
              enumerable: true,
              get: function () {
                if (exp === 'default') {
                  return x.__esModule ? x.default : x;
                }
                return x[exp];
              },
            });
          }
        });
        return m;
      }

      if (resolution?.id) {
        return loadAsset(resolution.id);
      }

      if (resolution?.specifier) {
        id = resolution.specifier;
      }

      if (id.startsWith('.')) {
        // Another bundle. Should already be loaded.
        return {};
      }

      return defaultRequire(id);
    };

    require.resolve = defaultRequire.resolve;

    return runModule(code, asset.filePath, cacheKey, require, parcelRequire);
  };

  let parcelRequire = (publicId: string) => {
    return loadAsset(nullthrows(assetsByPublicId.get(publicId)));
  };

  parcelRequire.root = parcelRequire;

  let publicUrl = bundle.target.publicUrl;
  if (!publicUrl.endsWith('/')) {
    publicUrl += '/';
  }
  parcelRequire.meta = {
    distDir: bundle.target.distDir,
    publicUrl,
  };

  let bundleLookup = bundleLookupCache.get(bundleGraph);
  if (!bundleLookup) {
    bundleLookup = new Map();
    for (let bundle of bundleGraph.getBundles()) {
      bundleLookup.set(bundle.publicId, bundle);
      bundleLookup.set(bundle.name, bundle);
    }
    bundleLookupCache.set(bundleGraph, bundleLookup);
  }

  parcelRequire.load = async (filePath: string) => {
    let bundle = bundleLookup?.get(filePath);
    if (bundle) {
      let {assets: subAssets} = await loadBundle(
        bundle,
        bundleGraph,
        getInlineBundleContents,
      );
      for (let [id, [bundle, asset, code]] of subAssets) {
        if (!assets.has(id)) {
          assets.set(id, [bundle, asset, code]);
          assetsByFilePath.set(getCacheKey(asset), asset.id);
          assetsByPublicId.set(bundleGraph.getAssetPublicId(asset), asset.id);
        }
      }
    } else {
      throw new Error('Bundle not found');
    }
  };

  parcelRequire.resolve = (url: string) => {
    let bundle = bundleLookup?.get(url);
    if (bundle) {
      return urlJoin(bundle.target.publicUrl, bundle.name);
    } else {
      throw new Error('Bundle not found');
    }
  };

  // No-op. We can access the bundle graph directly.
  parcelRequire.extendImportMap = () => {};

  // Resolve and load a module by specifier.
  let loadModule = (id: string, from: string, env = 'react-client') => {
    let resolver = env === 'react-server' ? serverResolver : clientResolver;
    let res = resolver.resolve({
      filename: id,
      specifierType: 'commonjs',
      parent: from,
    });

    if (res.error) {
      throw new Error(`Could not resolve module "${id}" from "${from}"`);
    }

    let defaultRequire = Module.createRequire(from);
    let resolution = res.resolution;
    if (resolution.type === 'Builtin') {
      let {scheme, module} = resolution.value;
      return defaultRequire(scheme ? `${scheme}:${module}` : module);
    }

    if (resolution.type === 'Path') {
      let cacheKey = resolution.value + '#' + env;
      const cachedModule = moduleCache.get(cacheKey);
      if (cachedModule) {
        return cachedModule.exports;
      }

      let assetId = assetsByFilePath.get(cacheKey);
      if (assetId) {
        return loadAsset(assetId);
      }

      let filePath = resolution.value;
      let code = fs.readFileSync(filePath, 'utf8');
      let require = (id: string) => {
        return loadModule(id, filePath, env);
      };

      require.resolve = defaultRequire.resolve;

      return runModule(code, filePath, cacheKey, require, parcelRequire);
    }

    throw new Error('Unknown resolution');
  };

  return {load: loadAsset, loadModule, assets};
}

function createContext(options) {
  // Create a fresh global context to execute code in on each build to avoid memory leaks.
  // $FlowFixMe
  let context: any = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  context.global = context;
  context.AsyncLocalStorage = AsyncLocalStorage;
  context.process = new Proxy(process, {
    get(target, prop, receiver) {
      // Expose the provided environment variables from Parcel instead of the global ones.
      if (prop === 'env') {
        return options.env;
      }

      return Reflect.get(target, prop, receiver);
    },
  });

  // $FlowFixMe
  for (let key of Object.getOwnPropertyNames(globalThis)) {
    if (!context.hasOwnProperty(key)) {
      Object.defineProperty(
        context,
        key,
        // $FlowFixMe
        Object.getOwnPropertyDescriptor(globalThis, key),
      );
    }
  }

  return context;
}

function runModule(
  code: string,
  filename: string,
  id: string,
  require: (id: string) => any,
  parcelRequire: (id: string) => any,
) {
  let moduleFunction = vm.compileFunction(
    code,
    [
      'exports',
      'require',
      'module',
      '__dirname',
      '__filename',
      'parcelRequire',
    ],
    {
      filename,
      parsingContext: context,
    },
  );

  let dirname = path.dirname(filename);
  let module = {
    exports: {},
    require,
    children: [],
    filename,
    id,
    path: dirname,
    bundle: parcelRequire,
  };

  moduleCache.set(id, module);
  moduleFunction(
    module.exports,
    require,
    module,
    dirname,
    filename,
    parcelRequire,
  );
  return module.exports;
}

function getCacheKey(asset: Asset) {
  return (
    asset.filePath +
    '#' +
    asset.env.context +
    (asset.uniqueKey ? '-' + asset.uniqueKey : '')
  );
}

function getSpecifier(dep: Dependency) {
  if (typeof dep.meta.placeholder === 'string') {
    return dep.meta.placeholder;
  }

  return dep.specifier;
}

function pageMeta(meta: Meta): any {
  if (
    meta.ssgMeta &&
    typeof meta?.ssgMeta === 'object' &&
    !Array.isArray(meta.ssgMeta)
  ) {
    return meta.ssgMeta;
  }
  return {};
}
