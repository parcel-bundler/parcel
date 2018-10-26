const fs = require('fs');
const {promisify} = require('@parcel/utils');
const path = require('path');
const {mkdirp} = require('@parcel/fs');

class Packager {
  constructor(bundle, bundler) {
    this.bundle = bundle;
    this.bundler = bundler;
    this.options = bundler.options;
  }

  static shouldAddAsset() {
    return true;
  }

  async setup() {
    // Create sub-directories if needed
    if (this.bundle.name.includes(path.sep)) {
      await mkdirp(path.dirname(this.bundle.name));
    }

    this.dest = fs.createWriteStream(this.bundle.name);
    this.dest.write = promisify(this.dest.write.bind(this.dest));
    this.dest.end = promisify(this.dest.end.bind(this.dest));
  }

  async write(string) {
    await this.dest.write(string);
  }

  async start() {}

  // eslint-disable-next-line no-unused-vars
  async addAsset(asset) {
    throw new Error('Must be implemented by subclasses');
  }

  getSize() {
    return this.dest.bytesWritten;
  }

  async end() {
    await this.dest.end();
  }
}

module.exports = Packager;
