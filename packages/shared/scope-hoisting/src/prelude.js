var $parcel$modules = {};
var $parcel$bundles = {};

if (parcelRequire == null) {
  parcelRequire = function(name) {
    // Execute the bundle wrapper function if there is one registered.
    if (name in $parcel$bundles) {
      if (
        parcelRequire._loadedBundles == null ||
        typeof parcelRequire._loadedBundles !== 'object'
      ) {
        throw new Error(
          'Expected parcelRequire._loadedBundles to be initialized',
        );
      }

      for (var i = 0; i < $parcel$bundles[name].length; i++) {
        var tuple = $parcel$bundles[name][i];
        if (parcelRequire._loadedBundles[tuple[0]]) {
          var wrapper = tuple[1];
          delete $parcel$bundles[name];
          wrapper();
          break;
        }
      }
    }

    if (name in $parcel$modules) {
      return $parcel$modules[name];
    }

    // Try the node require function if it exists.
    // Do not use `require` to prevent Webpack from trying to bundle this call
    if (typeof module !== 'undefined' && typeof module.require === 'function') {
      return module.require(name);
    }

    var err = new Error("Cannot find module '" + name + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };

  parcelRequire.register = function register(id, exports) {
    $parcel$modules[id] = exports;
  };

  parcelRequire.registerBundle = function registerBundle(id, fn, bundleId) {
    if (id in $parcel$modules) {
      return;
    }
    $parcel$bundles[id] = $parcel$bundles[id] || [];
    $parcel$bundles[id].push([bundleId, fn]);
    $parcel$modules[id] = {};
  };

  $parcel$global[parcelRequireName] = parcelRequire;
}
