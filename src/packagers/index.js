const JSPackager = require('./JSPackager');
const CSSPackager = require('./CSSPackager');
const RawPackager = require('./RawPackager');

const PACKAGERS = {
  js: JSPackager,
  css: CSSPackager
};

module.exports = function (type) {
  return PACKAGERS[type] || RawPackager;
};
