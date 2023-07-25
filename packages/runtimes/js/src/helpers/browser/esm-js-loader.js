function load(id, base) {
  let bundleId = require('../bundle-manifest').resolve(id);
  let request = base ? './' + base + bundleId : './' + bundleId;

  // eslint-disable-next-line no-undef
  return __parcel__import__(request);
}

module.exports = load;
