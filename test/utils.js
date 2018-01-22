const Bundler = require('../');
const rimraf = require('rimraf');
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

beforeEach(async function() {
  // Test run in a single process, creating and deleting the same file(s)
  // Windows needs a delay for the file handles to be released before deleting
  // is possible. Without a delay, rimraf fails on `beforeEach` for `/dist`
  if (process.platform === 'win32') {
    await sleep(50);
  }
  // Unix based systems also need a delay but only half as much as windows
  await sleep(50);
  rimraf.sync(path.join(__dirname, 'dist'));
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bundler(file, opts) {
  return new Bundler(
    file,
    Object.assign(
      {
        outDir: path.join(__dirname, 'dist'),
        watch: false,
        cache: false,
        killWorkers: false,
        hmr: false,
        logLevel: 0
      },
      opts
    )
  );
}

function bundle(file, opts) {
  return bundler(file, opts).bundle();
}

function run(bundle, globals, opts = {}) {
  // for testing dynamic imports
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
                  fs.readFileSync(path.join(__dirname, 'dist', el.src)),
                  ctx
                );
              }

              el.onload();
            }, 0);
          }
        }
      ];
    }
  };

  var ctx = Object.assign(
    {
      document: fakeDocument,
      WebSocket,
      console,
      location: {hostname: 'localhost'},
      fetch(url) {
        return Promise.resolve({
          arrayBuffer() {
            return Promise.resolve(
              new Uint8Array(fs.readFileSync(path.join(__dirname, 'dist', url)))
                .buffer
            );
          }
        });
      }
    },
    globals
  );

  ctx.window = ctx;

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(bundle.name), ctx);

  if (opts.require !== false) {
    return ctx.require(bundle.entryAsset.id);
  }

  return ctx;
}

function assertBundleTree(bundle, tree) {
  if (tree.name) {
    assert.equal(path.basename(bundle.name), tree.name);
  }

  if (tree.type) {
    assert.equal(bundle.type, tree.type);
  }

  if (tree.assets) {
    assert.deepEqual(
      Array.from(bundle.assets)
        .map(a => a.basename)
        .sort(),
      tree.assets.sort()
    );
  }

  if (tree.childBundles) {
    let children = Array.from(bundle.childBundles).sort(
      (a, b) =>
        Array.from(a.assets).sort()[0].basename <
        Array.from(b.assets).sort()[0].basename
          ? -1
          : 1
    );
    assert.equal(bundle.childBundles.size, tree.childBundles.length);
    tree.childBundles.forEach((b, i) => assertBundleTree(children[i], b));
  }

  if (/js|css/.test(bundle.type)) {
    assert(fs.existsSync(bundle.name));
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

exports.sleep = sleep;
exports.bundler = bundler;
exports.bundle = bundle;
exports.run = run;
exports.assertBundleTree = assertBundleTree;
exports.nextBundle = nextBundle;
exports.deferred = deferred;
