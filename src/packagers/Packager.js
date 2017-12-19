const fs = require('fs');
const promisify = require('../utils/promisify');
const path = require('path');
const fsUtil = require('../utils/fs');

class Packager {
  constructor(bundle, bundler) {
    this.bundle = bundle;
    this.bundler = bundler;
    this.options = bundler.options;
  }

  async setup() {
    if (this.options.keepFileName) {
      await fsUtil.mkdirp(path.dirname(this.bundle.name));
    }
    this.dest = fs.createWriteStream(this.bundle.name);
    this.dest.write = promisify(this.dest.write.bind(this.dest));
    this.dest.end = promisify(this.dest.end.bind(this.dest));
  }

  getBundleRelativeName(fromBundle, toBundle) {
    if (!fromBundle || !toBundle) return '';
    return path.relative(path.dirname(fromBundle.name), toBundle.name);
  }

  async start() {}

  async addAsset(asset) {
    throw new Error('Must be implemented by subclasses');
  }

  async end() {
    await this.dest.end();
  }
}

module.exports = Packager;
