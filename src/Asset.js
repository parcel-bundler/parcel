const URL = require('url');
const path = require('path');
const fs = require('./utils/fs');
const objectHash = require('./utils/objectHash');
const md5 = require('./utils/md5');
const isURL = require('./utils/is-url');
const config = require('./utils/config');

let ASSET_ID = 1;

/**
 * An Asset represents a file in the dependency tree. Assets can have multiple
 * parents that depend on it, and can be added to multiple output bundles.
 * The base Asset class doesn't do much by itself, but sets up an interface
 * for subclasses to implement.
 */
class Asset {
  constructor(name, pkg, options) {
    this.id = ASSET_ID++;
    this.name = name;
    this.basename = path.basename(this.name);
    this.relativeName = path.relative(options.rootDir, this.name);
    this.package = pkg || {};
    this.options = options;
    this.encoding = 'utf8';
    this.type = path.extname(this.name).slice(1);

    this.processed = false;
    this.contents = options.rendition ? options.rendition.value : null;
    this.ast = null;
    this.generated = null;
    this.hash = null;
    this.parentDeps = new Set();
    this.dependencies = new Map();
    this.depAssets = new Map();
    this.parentBundle = null;
    this.bundles = new Set();
    this.cacheData = {};
    this.buildTime = 0;
    this.bundledSize = 0;
  }

  shouldInvalidate() {
    return false;
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
    if (
      this.options.rendition &&
      this.options.rendition.hasDependencies === false
    ) {
      return;
    }

    await this.loadIfNeeded();

    if (this.contents && this.mightHaveDependencies()) {
      await this.parseIfNeeded();
      await this.collectDependencies();
    }
  }

  addDependency(name, opts) {
    this.dependencies.set(name, Object.assign({name}, opts));
  }

  addURLDependency(url, from = this.name, opts) {
    if (!url || isURL(url)) {
      return url;
    }

    if (typeof from === 'object') {
      opts = from;
      from = this.name;
    }

    const parsed = URL.parse(url);
    const resolved = path.resolve(
      path.dirname(from),
      decodeURIComponent(parsed.pathname)
    );
    this.addDependency(
      './' + path.relative(path.dirname(this.name), resolved),
      Object.assign({dynamic: true}, opts)
    );

    parsed.pathname = this.options.parser
      .getAsset(resolved, this.package, this.options)
      .generateBundleName();

    return URL.format(parsed);
  }

  async getConfig(filenames, opts = {}) {
    // Resolve the config file
    let conf = await config.resolve(opts.path || this.name, filenames);
    if (conf) {
      // Add as a dependency so it is added to the watcher and invalidates
      // this asset when the config changes.
      this.addDependency(conf, {includedInParent: true});
      if (opts.load === false) {
        return conf;
      }

      return await config.load(opts.path || this.name, filenames);
    }

    return null;
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

  async pretransform() {
    // do nothing by default
  }

  async transform() {
    // do nothing by default
  }

  async generate() {
    return {
      [this.type]: this.contents
    };
  }

  async process() {
    if (!this.generated) {
      await this.loadIfNeeded();
      await this.pretransform();
      await this.getDependencies();
      await this.transform();
      this.generated = await this.generate();
      this.hash = await this.generateHash();
    }

    return this.generated;
  }

  async postProcess(generated) {
    return generated;
  }

  generateHash() {
    return objectHash(this.generated);
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
    // Generate a unique name. This will be replaced with a nicer
    // name later as part of content hashing.
    return md5(this.name) + '.' + this.type;
  }

  replaceBundleNames(bundleNameMap) {
    for (let key in this.generated) {
      let value = this.generated[key];
      if (typeof value === 'string') {
        // Replace temporary bundle names in the output with the final content-hashed names.
        for (let [name, map] of bundleNameMap) {
          value = value.split(name).join(map);
        }

        this.generated[key] = value;
      }
    }
  }

  generateErrorMessage(err) {
    return err;
  }
}

module.exports = Asset;
