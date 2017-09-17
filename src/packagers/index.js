const JSPackager = require('./JSPackager');
const CSSPackager = require('./CSSPackager');
const HTMLPackager = require('./HTMLPackager');
const RawPackager = require('./RawPackager');

const PACKAGERS = {
  js: JSPackager,
  css: CSSPackager,
  html: HTMLPackager
};

module.exports = function (type) {
  return PACKAGERS[type] || RawPackager;
};
