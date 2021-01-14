var $parcel$modules = {};
var $parcel$bundles = {};

if (parcelRequire == null) {
  parcelRequire = function(name) {
    // Execute the bundle wrapper function if there is one registered.
    if (name in $parcel$bundles) {
      $parcel$bundles[name]();
      delete $parcel$bundles[name];
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
    exports.__$parcel$init = true;
    $parcel$modules[id] = exports;
  };

  parcelRequire.registerBundle = function registerBundle(id, fn) {
    $parcel$bundles[id] = fn;
    function init() {
      return $parcel$modules[id] === init ? undefined : $parcel$modules[id]();
    }
    init.__$parcel$init = true;
    $parcel$modules[id] = init;
  };

  $parcel$global[parcelRequireName] = parcelRequire;
}
