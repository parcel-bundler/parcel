const Bundler = require('../');
const rimraf = require('rimraf');
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

beforeEach(function(done) {
  const finalize = () => {
    rimraf.sync(path.join(__dirname, 'dist'));
    done();
  };

  // Test run in a single process, creating and deleting the same file(s)
  // Windows needs a delay for the file handles to be released before deleting
  // is possible. Without a delay, rimraf fails on `beforeEach` for `/dist`
  if (process.platform === 'win32') {
    sleep(50).then(finalize);
  } else {
    finalize();
  }
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

function run(bundle, globals) {
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
                // if the URL begins with read-content:// then it's just an inlined blob
                const inlined = el.src.match(/^read-content:\/\/([^]*)/);
                let code = inlined && inlined.pop();

                if (!code) {
                  code = fs.readFileSync(path.join(__dirname, 'dist', el.src));
                }

                vm.runInContext(code, ctx);
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

      // these are used in src/builtins/bundle-loader.js
      fetch(url) {
        return Promise.resolve({
          text() {
            return fs.readFileSync(path.join(__dirname, 'dist', url));
          }
        });
      },
      Blob: function(parts) {
        this.data = parts.reduce((a, b) => a + b);
      },
      URL: {
        createObjectURL(blob) {
          return 'read-content://' + blob.data;
        }
      }
    },
    globals
  );

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(bundle.name), ctx);
  return ctx.require(bundle.entryAsset.id);
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

exports.sleep = sleep;
exports.bundler = bundler;
exports.bundle = bundle;
exports.run = run;
exports.assertBundleTree = assertBundleTree;
