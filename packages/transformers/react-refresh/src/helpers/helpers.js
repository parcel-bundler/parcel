function debounce(func, delay) {
  var timeout = undefined;
  return function(args) {
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      timeout = undefined;
      func.call(null, args);
    }, delay);
  };
}
var enqueueUpdate = debounce(function(Refresh) {
  Refresh.performReactRefresh();
}, 30);

module.exports.prelude = function(Refresh, mod) {
  window.$RefreshReg$ = function(type, id) {
    Refresh.register(type, mod.id + ' ' + id);
  };
  window.$RefreshSig$ = Refresh.createSignatureFunctionForTransform;
};

module.exports.postlude = function(Refresh, mod) {
  if (isReactRefreshBoundary(Refresh, mod)) {
    registerExportsForReactRefresh(Refresh, mod);

    mod.hot.accept();
    if (Refresh.hasUnrecoverableErrors()) {
      window.location.reload();
    }
    enqueueUpdate(Refresh);
  }
};

// https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L748-L774
function isReactRefreshBoundary(Refresh, mod) {
  var exports = mod.exports;
  if (Refresh.isLikelyComponentType(exports)) {
    return true;
  }

  if (!exports || typeof exports !== 'object') {
    return false;
  }

  var hasExports = false;
  for (var key in exports) {
    if (key === '__esModule') {
      continue;
    }
    hasExports = true;

    if (!Refresh.isLikelyComponentType(exports[key])) {
      return false;
    }
  }

  return hasExports;
}

// https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L818-L835
function registerExportsForReactRefresh(Refresh, mod) {
  var exports = mod.exports;
  var id = mod.id;

  if (Refresh.isLikelyComponentType(exports)) {
    // Register module.exports if it is likely a component
    Refresh.register(exports, id + ' exports');
  }

  if (!exports || typeof exports !== 'object') {
    return;
  }

  for (var key in exports) {
    if (key === '__esModule') {
      continue;
    }

    var exportValue = exports[key];
    if (Refresh.isLikelyComponentType(exportValue)) {
      Refresh.register(exportValue, id + ' exports%' + key);
    }
  }
}
