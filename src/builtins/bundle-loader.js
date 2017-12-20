var getBundleURL = require('./bundle-url').getBundleURL;

function loadBundles(bundles) {
  var id = Array.isArray(bundles) ? bundles[bundles.length - 1] : bundles;

  try {
    return Promise.resolve(require(id));
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return new LazyPromise(function (resolve, reject) {
        Promise.all(bundles.slice(0, -1).map(loadBundle)).then(function () {
          return require(id);
        }).then(resolve, reject);
      });
    }

    throw err;
  }
}

module.exports = exports = loadBundles;

var bundles = {};
var bundleLoaders = {
  js: loadJSBundle,
  css: loadCSSBundle
};

function loadBundle(bundle) {
  if (bundles[bundle]) {
    return bundles[bundle];
  }

  var type = bundle.match(/\.(.+)$/)[1].toLowerCase();
  var bundleLoader = bundleLoaders[type];
  if (bundleLoader) {
    return bundles[bundle] = bundleLoader(getBundleURL() + bundle);
  }
}

var jsBundleCallbacks = {};
var jsBundleIdCounter = 0;

// fetch polyfill for Node.js and the browser
var localFetch = typeof fetch === 'undefined' ?
  require('fetch-ponyfill')({Promise: Promise}).fetch :
  fetch;

function loadJSBundle(bundle) {
  var globalObject = null;

  // browser
  if (typeof window !== 'undefined') {
    globalObject = window;
  }
  // node.js
  else if (typeof global !== 'undefined') {
    globalObject = global;
  }
  // WebWorker
  else if (typeof self !== 'undefined') {
    globalObject = self;
  }
  
  if (globalObject.__parcel_bundle_callbacks != jsBundleCallbacks) {
    globalObject.__parcel_bundle_callbacks = jsBundleCallbacks;
  }

  var promise = localFetch(bundle)
    .then(function(response) {
      return response.text();
    })
    .then(function(contents) {
      return new Promise((resolve, reject) => {
        var bundleId = jsBundleIdCounter++;
        var callback = function(exported) {
          delete jsBundleCallbacks[bundleId];

          resolve(exported);
        }
  
        jsBundleCallbacks[bundleId] = callback;
        
        var prelude =
          'function __parcel_export_module(exported) {' +
            '__parcel_bundle_callbacks[' + bundleId + '](exported)' +
          '}';
  
        var script = document.createElement('script');
        var blob = new Blob([prelude, contents]);
        var blobUrl = URL.createObjectURL(blob);
  
        script.async = true;
        script.type = 'text/javascript';
        script.charset = 'utf-8';
        script.src = blobUrl;
        script.onerror = function (e) {
          script.onerror = script.onload = null;
          reject(e);
        };
  
        script.onload = function () {
          script.onerror = script.onload = null;
        };
  
        document.getElementsByTagName('head')[0].appendChild(script);
      })
    });

    return promise;
}

function loadCSSBundle(bundle) {
  return new Promise(function (resolve, reject) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = bundle;
    link.onerror = function (e) {
      link.onerror = link.onload = null;
      reject(e);
    };

    link.onload = function () {
      link.onerror = link.onload = null;
      resolve();
    };

    document.getElementsByTagName('head')[0].appendChild(link);
  });
}

function LazyPromise(executor) {
  this.executor = executor;
  this.promise = null;
}

LazyPromise.prototype.then = function (onSuccess, onError) {
  return this.promise || (this.promise = new Promise(this.executor).then(onSuccess, onError));
};

LazyPromise.prototype.catch = function (onError) {
  return this.promise || (this.promise = new Promise(this.executor).catch(onError));
};
