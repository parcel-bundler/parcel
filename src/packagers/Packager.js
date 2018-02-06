const fs = require('fs');
const promisify = require('../utils/promisify');

class Packager {
  constructor(bundle, bundler) {
    this.bundle = bundle;
    this.bundler = bundler;
    this.options = bundler.options;
    this.setup();
  }

  setup() {
    let filename;
    if (this.options.rev) {
      let hash = this.bundle
        .getHash()
        .toString()
        .substr(-8, 8);
      filename = this.bundle.name + '-' + hash;
    } else {
      filename = this.bundle.name;
    }
    this.dest = fs.createWriteStream(filename);
    this.dest.write = promisify(this.dest.write.bind(this.dest));
    this.dest.end = promisify(this.dest.end.bind(this.dest));
  }

  async start() {}

  // eslint-disable-next-line no-unused-vars
  async addAsset(asset) {
    throw new Error('Must be implemented by subclasses');
  }

  async end() {
    await this.dest.end();
  }
}

module.exports = Packager;
