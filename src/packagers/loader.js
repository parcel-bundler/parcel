function loadBundles(bundles) {
  var id = bundles.pop();

  try {
    return Promise.resolve(require(id));
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return new LazyPromise(function (resolve, reject) {
        Promise.all(bundles.map(bundle => loadBundle(bundle))).then(function () {
          let res = require(id);
          if (res.__esModule) {
            return res.default;
          }

          return res;
        }).then(resolve, reject);
      });
    }

    throw err;
  }
}

module.exports = loadBundles;

var bundles = {};
var baseURL = null;
var bundleLoaders = {
  js: loadJSBundle,
  css: loadCSSBundle
};

function loadBundle(bundle) {
  if (bundles[bundle]) {
    return bundles[bundle];
  }

  if (!baseURL) {
    baseURL = getBaseURL();
  }

  var type = bundle.match(/\.(.+)$/)[1].toLowerCase();
  return bundles[bundle] = bundleLoaders[type](baseURL + bundle);
}

function loadJSBundle(bundle) {
  return new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.async = true;
    script.type = 'text/javascript';
    script.charset = 'utf-8';
    script.src = bundle;
    script.onerror = function (e) {
      script.onerror = script.onload = null;
      reject(e);
    };

    script.onload = function () {
      script.onerror = script.onload = null;
      resolve();
    };
    document.head.appendChild(script);
  });
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

    document.head.appendChild(link);
  });
}

function getBaseURL() {
  // Attempt to find the URL of the current script and use that as the base URL
  try {
    throw new Error;
  } catch (err) {
    var matches = ('' + err.stack).match(/(https?|file|ftp):\/\/[^:\)]+/g);
    if (matches) {
      return matches[0].replace(/\/[^\/]+$/, '') + '/';
    }
  }

  return '/';
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
