function load(id) {
  // eslint-disable-next-line no-undef
  return __atlaspack__import__(require('../bundle-manifest').resolve(id));
}

module.exports = load;
