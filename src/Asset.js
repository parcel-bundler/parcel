const Parser = require('./Parser');
const path = require('path');
const fs = require('./utils/fs');
const crypto = require('crypto');
const md5 = require('./utils/md5');

const URL_RE = /^(([a-z]+:)|\/)/;

let ASSET_ID = 1;

/**
 * An Asset represents a file in the dependency tree. Assets can have multiple
 * parents that depend on it, and can be added to multiple output bundles.
 * The base Asset class doesn't to much by itself, but sets up an interface
 * for subclasses to implement.
 */
class Asset {
  constructor(name, pkg, options) {
    this.id = ASSET_ID++;
    this.name = name;
    this.basename = path.basename(this.name);
    this.package = pkg;
    this.options = options;
    this.encoding = 'utf8';
    this.type = path.extname(this.name).slice(1);

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
      this.ast = await this.parse(this.contents);
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

  addURLDependency(url, from = this.name) {
    if (!url || URL_RE.test(url)) {
      return url;
    }

    let resolved = path.resolve(path.dirname(from), url);
    this.addDependency('./' + path.relative(path.dirname(this.name), resolved), {dynamic: true});
    return this.options.parser.getAsset(resolved, this.package, this.options).generateBundleName();
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
      [this.type]: this.contents
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
      if (this.generated[key]) {
        hash.update(this.generated[key]);
      }
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
    this.parentDeps.clear();
  }

  generateBundleName() {
    // Resolve the main file of the package.json
    let main = this.package ? path.resolve(path.dirname(this.package.pkgfile), this.package.main) : null;
    let ext = '.' + this.type;

    // If this asset is main file of the package, use the package name
    if (this.name === main) {
      return this.package.name + ext;
    }

    // Otherwise generate a unique name
    return md5(this.name) + ext;
  }
}

module.exports = Asset;
