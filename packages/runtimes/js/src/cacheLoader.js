let cachedBundles = {};

module.exports = function cacheLoader(loader) {
  return function(bundle) {
    if (cachedBundles[bundle]) {
      return cachedBundles[bundle];
    }

    return (cachedBundles[bundle] = loader(bundle).catch(function(e) {
      delete cachedBundles[bundle];
      throw e;
    }));
  };
};
