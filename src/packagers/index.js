const JSConcatPackager = require('./JSConcatPackager');
const JSPackager = require('./JSPackager');
const CSSPackager = require('./CSSPackager');
const HTMLPackager = require('./HTMLPackager');
const SourceMapPackager = require('./SourceMapPackager');
const RawPackager = require('./RawPackager');

class PackagerRegistry {
  constructor(options) {
    this.packagers = new Map();

    this.add('css', CSSPackager);
    this.add('html', HTMLPackager);
    this.add('map', SourceMapPackager);
    this.add('js', options.scopeHoist ? JSConcatPackager : JSPackager);
  }

  add(type, packager) {
    if (typeof packager === 'string') {
      packager = require(packager);
    }

    this.packagers.set(type, packager);
  }

  has(type) {
    return this.packagers.has(type);
  }

  get(type) {
    return this.packagers.get(type) || RawPackager;
  }
}

module.exports = PackagerRegistry;
