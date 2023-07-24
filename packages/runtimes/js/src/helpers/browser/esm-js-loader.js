function load(id, base) {
  const bundleId = require('../bundle-manifest').resolve(id);
  const request = base ? './' + base + '/' + bundleId : './' + bundleId;

  // eslint-disable-next-line no-undef
  return __parcel__import__(request);
}

module.exports = load;
