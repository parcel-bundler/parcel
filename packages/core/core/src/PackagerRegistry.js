// const JSConcatPackager = require('./JSConcatPackager');

class PackagerRegistry {
  constructor(options) {
    this.packagers = new Map();

    this.RawPackager = require('@parcel/packager-raw');
    this.add('css', require('@parcel/packager-css'));
    this.add('html', require('@parcel/packager-html'));
    this.add('map', require('@parcel/packager-sourcemap'));
    this.add(
      'js',
      options.scopeHoist ? JSConcatPackager : require('@parcel/packager-js')
    );
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
    return this.packagers.get(type) || this.RawPackager;
  }
}

module.exports = PackagerRegistry;
