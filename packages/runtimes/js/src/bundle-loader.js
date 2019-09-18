var getBundleURL = require('./bundle-url').getBundleURL;

function loadBundlesLazy(bundles) {
  if (!Array.isArray(bundles)) {
    bundles = [bundles];
  }

  var id = bundles[bundles.length - 1];

  try {
    return Promise.resolve(require(id));
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return new Promise(function(resolve, reject) {
        loadBundles(bundles.slice(0, -1))
          .then(function() {
            return require(id);
          })
          .then(resolve, reject);
      });
    }

    throw err;
  }
}

function loadBundles(bundles) {
  return Promise.all(bundles.map(loadBundle));
}

var bundleLoaders = {};
function registerBundleLoader(type, loader) {
  bundleLoaders[type] = loader;
}

module.exports = exports = loadBundlesLazy;
exports.load = loadBundles;
exports.register = registerBundleLoader;

var bundles = {};
function loadBundle([bundleLoader, bundle]) {
  var id;
  if (Array.isArray(bundle)) {
    id = bundle[1];
    bundle = bundle[0];
  }

  if (bundles[bundle]) {
    return bundles[bundle];
  }

  if (bundleLoader) {
    return (bundles[bundle] = bundleLoader(getBundleURL() + bundle)
      .then(function(resolved) {
        if (resolved) {
          module.bundle.register(id, resolved);
        }

        return resolved;
      })
      .catch(function(e) {
        delete bundles[bundle];

        throw e;
      }));
  }
}
