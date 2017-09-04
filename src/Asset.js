const Parser = require('./Parser');
const path = require('path');
const fs = require('./utils/fs');
const crypto = require('crypto');

let ASSET_ID = 1;

class Asset {
  constructor(name, pkg, options) {
    this.id = ASSET_ID++;
    this.name = name;
    this.basename = path.basename(this.name);
    this.package = pkg;
    this.options = options;
    this.encoding = 'utf8';
    this.type = 'raw';

    this.processed = false;
    this.contents = null;
    this.ast = null;
    this.generated = null;
    this.hash = null;
    this.parentDeps = new Set;
    this.dependencies = new Map;
    this.depAssets = new Map;
    this.parentBundle = null;
    this.bundles = new Set;
  }

  async loadIfNeeded() {
    if (this.contents == null) {
      this.contents = await this.load();
    }
  }

  async parseIfNeeded() {
    await this.loadIfNeeded();
    if (!this.ast) {
      this.ast = this.parse(this.contents);
    }
  }

  async getDependencies() {
    await this.loadIfNeeded();

    if (this.mightHaveDependencies()) {
      await this.parseIfNeeded();
      this.collectDependencies();
    }
  }

  addDependency(name, opts) {
    this.dependencies.set(name, Object.assign({name}, opts));
  }

  mightHaveDependencies() {
    return true;
  }

  async load() {
    return await fs.readFile(this.name, this.encoding);
  }

  parse() {
    // do nothing by default
  }

  collectDependencies() {
    // do nothing by default
  }

  async transform() {
    // do nothing by default
  }

  generate() {
    return {
      raw: this.contents
    };
  }

  async process() {
    if (!this.generated) {
      await this.getDependencies();
      await this.transform();
      this.generated = this.generate();
      this.hash = this.generateHash();
    }

    return this.generated;
  }

  generateHash() {
    let hash = crypto.createHash('md5');
    for (let key in this.generated) {
      hash.update(this.generated[key]);
    }

    return hash.digest('hex');
  }

  invalidate() {
    this.processed = false;
    this.contents = null;
    this.ast = null;
    this.generated = null;
    this.hash = null;
    this.dependencies.clear();
    this.depAssets.clear();
  }

  invalidateBundle() {
    this.parentBundle = null;
    this.bundles.clear();
  }
}

module.exports = Asset;
