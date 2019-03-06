const Bundler = require('parcel-bundler');
const assert = require('assert');
const vm = require('vm');
const fs = require('@parcel/fs');
const nodeFS = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Module = require('module');

const {promisify} = require('@parcel/utils');
//const {sleep} = require('@parcel/test-utils');
const rimraf = promisify(require('rimraf'));
const ncp = promisify(require('ncp'));

const chalk = new (require('chalk')).constructor({enabled: true});
const warning = chalk.keyword('orange');
// eslint-disable-next-line no-console
console.warn = (...args) => {
  // eslint-disable-next-line no-console
  console.error(warning(...args));
};

async function removeDistDirectory(count = 0) {
  try {
    await rimraf(path.join(process.cwd(), 'test/dist'));
  } catch (e) {
    if (count > 8) {
      // eslint-disable-next-line no-console
      console.warn('WARNING: Unable to remove dist directory:', e.message);
      return;
    }

    await sleep(250);
    await removeDistDirectory(count + 1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function symlinkPrivilegeWarning() {
  // eslint-disable-next-line no-console
  console.warn(
    `-----------------------------------
Skipping symbolic link test(s) because you don't have the privilege.
Run tests with Administrator privilege.
If you don't know how, check here: https://bit.ly/2UmWsbD
-----------------------------------`
  );
}

function bundler(file, opts) {
  return new Bundler(
    file,
    Object.assign(
      {
        outDir: path.join(process.cwd(), 'test/dist'),
        watch: false,
        cache: false,
        killWorkers: false,
        hmr: false,
        logLevel: 0,
        throwErrors: true
      },
      opts
    )
  );
}

function bundle(file, opts) {
  return bundler(file, opts).bundle();
}

async function run(bundle, globals, opts = {}) {
  var ctx;
  switch (bundle.entryAsset.options.target) {
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
  vm.runInContext(await fs.readFile(bundle.name), ctx);

  if (opts.require !== false) {
    if (ctx.parcelRequire) {
      return ctx.parcelRequire(bundle.entryAsset.id);
    } else if (ctx.output) {
      return ctx.output;
    }
    if (ctx.module) {
      return ctx.module.exports;
    }
  }

  return ctx;
}

async function assertBundleTree(bundle, tree) {
  if (tree.name) {
    assert.equal(
      path.basename(bundle.name),
      tree.name,
      'bundle names mismatched'
    );
  }

  if (tree.type) {
    assert.equal(
      bundle.type.toLowerCase(),
      tree.type.toLowerCase(),
      'bundle types mismatched'
    );
  }

  if (tree.assets) {
    assert.deepEqual(
      Array.from(bundle.assets)
        .map(a => a.basename)
        .sort(),
      tree.assets.sort()
    );
  }

  let childBundles = Array.isArray(tree) ? tree : tree.childBundles;
  if (childBundles) {
    let children = Array.from(bundle.childBundles).sort((a, b) => {
      let assetA = Array.from(a.assets).sort()[0];
      let assetB = Array.from(b.assets).sort()[0];
      if (assetA.basename < assetB.basename) {
        return -1;
      } else if (assetA.basename > assetB.basename) {
        return 1;
      } else {
        return a.type < b.type ? -1 : 1;
      }
    });
    assert.equal(
      bundle.childBundles.size,
      childBundles.length,
      'expected number of child bundles mismatched'
    );
    await Promise.all(
      childBundles.map((b, i) => assertBundleTree(children[i], b))
    );
  }

  if (/js|css/.test(bundle.type)) {
    assert(await fs.exists(bundle.name), 'expected file does not exist');
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
                    path.join(path.dirname(bundle.name), el.src)
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
      location: {hostname: 'localhost', reload() {}},
      fetch(url) {
        return Promise.resolve({
          arrayBuffer() {
            return Promise.resolve(
              new Uint8Array(
                nodeFS.readFileSync(path.join(path.dirname(bundle.name), url))
              ).buffer
            );
          },
          text() {
            return Promise.resolve(
              nodeFS.readFileSync(
                path.join(path.dirname(bundle.name), url),
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
  var mod = new Module(bundle.name);
  mod.paths = [path.dirname(bundle.name) + '/node_modules'];

  var ctx = Object.assign(
    {
      module: mod,
      exports: module.exports,
      __filename: bundle.name,
      __dirname: path.dirname(bundle.name),
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

exports.sleep = sleep;
exports.removeDistDirectory = removeDistDirectory;
exports.symlinkPrivilegeWarning = symlinkPrivilegeWarning;
exports.bundler = bundler;
exports.bundle = bundle;
exports.run = run;
exports.prepareBrowserContext = prepareBrowserContext;
exports.assertBundleTree = assertBundleTree;
exports.nextBundle = nextBundle;
exports.deferred = deferred;
exports.rimraf = rimraf;
exports.ncp = ncp;
exports.normaliseNewlines = normaliseNewlines;
