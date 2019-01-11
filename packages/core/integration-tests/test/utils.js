const Parcel = require('@parcel/core');
const assert = require('assert');
const vm = require('vm');
const fs = require('@parcel/fs');
const nodeFS = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Module = require('module');

const {promisify} = require('@parcel/utils');
const rimraf = promisify(require('rimraf'));
const ncp = promisify(require('ncp'));
const {sleep} = require('@parcel/test-utils');

const chalk = new (require('chalk')).constructor({enabled: true});
const warning = chalk.keyword('orange');
// eslint-disable-next-line no-console
console.warn = (...args) => {
  // eslint-disable-next-line no-console
  console.error(warning(...args));
};

// async function removeDistDirectory(count = 0) {
//   try {
//     await rimraf('.parcel-cache');
//     await rimraf('dist');
//   } catch (e) {
//     if (count > 8) {
//       // eslint-disable-next-line no-console
//       console.warn('WARNING: Unable to remove dist directory:', e.message);
//       return;
//     }

//     await sleep(250);
//     await removeDistDirectory(count + 1);
//   }
// }

beforeEach(async function() {
  await sleep(250);
  //   await removeDistDirectory();
});

function bundler(entries, opts) {
  return new Parcel(
    Object.assign(
      {
        entries,
        cliOpts: {
          cache: false
        },
        killWorkers: false
      },
      opts
    )
  );
  // return new Parcel(
  //   file,
  //   Object.assign(
  //     {
  //       outDir: path.join(__dirname, 'dist'),
  //       watch: false,
  //       cache: false,
  //       killWorkers: false,
  //       hmr: false,
  //       logLevel: 0,
  //       throwErrors: true
  //     },
  //     opts
  //   )
  // );
}

function bundle(entries, opts) {
  return bundler(entries, opts).run();
}

function prepareBrowserContext(bundle, globals) {
  // for testing dynamic imports
  const fakeElement = {
    remove() {}
  };

  const fakeDocument = {
    createElement(tag) {
      return {tag};
    },

    getElementsByTagName() {
      return [
        {
          appendChild(el) {
            setTimeout(function() {
              if (el.tag === 'script') {
                vm.runInContext(
                  nodeFS.readFileSync(
                    path.join(path.dirname(bundle.filePath), el.src)
                  ),
                  ctx
                );
              }

              el.onload();
            }, 0);
          }
        }
      ];
    },

    getElementById() {
      return fakeElement;
    },

    body: {
      appendChild() {
        return null;
      }
    }
  };

  var exports = {};
  var ctx = Object.assign(
    {
      exports,
      module: {exports},
      document: fakeDocument,
      WebSocket,
      console,
      location: {hostname: 'localhost'},
      fetch(url) {
        return Promise.resolve({
          arrayBuffer() {
            return Promise.resolve(
              new Uint8Array(
                nodeFS.readFileSync(
                  path.join(path.dirname(bundle.filePath), url)
                )
              ).buffer
            );
          },
          text() {
            return Promise.resolve(
              nodeFS.readFileSync(
                path.join(path.dirname(bundle.filePath), url),
                'utf8'
              )
            );
          }
        });
      }
    },
    globals
  );

  ctx.window = ctx;
  return ctx;
}

function prepareNodeContext(bundle, globals) {
  var mod = new Module(bundle.filePath);
  mod.paths = [path.dirname(bundle.filePath) + '/node_modules'];

  var ctx = Object.assign(
    {
      module: mod,
      exports: module.exports,
      __filename: bundle.filePath,
      __dirname: path.dirname(bundle.filePath),
      require: function(path) {
        return mod.require(path);
      },
      console,
      process: process,
      setTimeout: setTimeout,
      setImmediate: setImmediate
    },
    globals
  );

  ctx.global = ctx;
  return ctx;
}

async function run(bundleGraph, globals, opts = {}) {
  let bundle = Array.from(bundleGraph.nodes.values()).find(
    node => node.type === 'bundle' && node.value.isEntry
  ).value;
  let entryAsset = bundle.assetGraph.getEntryAssets()[0];
  let target = entryAsset.env.context;

  var ctx;
  switch (target) {
    case 'browser':
      ctx = prepareBrowserContext(bundle, globals);
      break;
    case 'node':
      ctx = prepareNodeContext(bundle, globals);
      break;
    case 'electron':
      ctx = Object.assign(
        prepareBrowserContext(bundle, globals),
        prepareNodeContext(bundle, globals)
      );
      break;
  }

  vm.createContext(ctx);
  vm.runInContext(await fs.readFile(bundle.filePath), ctx);

  if (opts.require !== false) {
    if (ctx.parcelRequire) {
      return ctx.parcelRequire(entryAsset.id);
    } else if (ctx.output) {
      return ctx.output;
    }
    if (ctx.module) {
      return ctx.module.exports;
    }
  }

  return ctx;
}

async function assertBundles(bundleGraph, bundles) {
  let actualBundles = [];
  bundleGraph.traverseBundles(bundle => {
    let assets = [];
    bundle.assetGraph.traverseAssets(asset => {
      assets.push(path.basename(asset.filePath));
    });

    assets.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    actualBundles.push({
      name: path.basename(bundle.filePath),
      type: bundle.type,
      assets
    });
  });

  for (let bundle of bundles) {
    bundle.assets.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  }

  bundles.sort((a, b) => (a.assets[0] < b.assets[0] ? -1 : 1));
  actualBundles.sort((a, b) => (a.assets[0] < b.assets[0] ? -1 : 1));
  assert.equal(
    actualBundles.length,
    bundles.length,
    'expected number of bundles mismatched'
  );

  let i = 0;
  for (let bundle of bundles) {
    let actualBundle = actualBundles[i++];
    if (bundle.name) {
      assert.equal(actualBundle.name, bundle.name);
    }

    if (bundle.type) {
      assert.equal(actualBundle.type, bundle.type);
    }

    if (bundle.assets) {
      assert.deepEqual(actualBundle.assets, bundle.assets);
    }

    // assert(await fs.exists(bundle.filePath), 'expected file does not exist');
  }
}

function nextBundle(b) {
  return new Promise(resolve => {
    b.once('bundled', resolve);
  });
}

function deferred() {
  let resolve, reject;
  let promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  promise.resolve = resolve;
  promise.reject = reject;

  return promise;
}

function normaliseNewlines(text) {
  return text.replace(/(\r\n|\n|\r)/g, '\n');
}

exports.bundler = bundler;
exports.bundle = bundle;
exports.run = run;
exports.assertBundles = assertBundles;
exports.nextBundle = nextBundle;
exports.deferred = deferred;
exports.rimraf = rimraf;
exports.ncp = ncp;
exports.normaliseNewlines = normaliseNewlines;
