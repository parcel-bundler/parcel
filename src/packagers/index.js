const JSPackager = require('./JSPackager');
const CSSPackager = require('./CSSPackager');
const HTMLPackager = require('./HTMLPackager');
const RawPackager = require('./RawPackager');
const WebManifestPackager = require('./WebManifestPackager');

class PackagerRegistry {
  constructor() {
    this.packagers = new Map();

    this.add('js', JSPackager);
    this.add('css', CSSPackager);
    this.add('html', HTMLPackager);
    this.add('webmanifest', WebManifestPackager);
  }

  add(type, packager) {
    if (typeof packager === 'string') {
      packager = require(packager);
    }

    this.packagers.set(type, packager);
  }

  get(type) {
    return this.packagers.get(type) || RawPackager;
  }
}

module.exports = PackagerRegistry;
