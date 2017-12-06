// @flow
const Parser = require('./Parser');
const path = require('path');
const fs = require('./utils/fs');
const objectHash = require('./utils/objectHash');
const md5 = require('./utils/md5');
const isURL = require('./utils/is-url');

let ASSET_ID = 1;

export type AssetOptions = {
  parser: any
};

/**
 * An Asset represents a file in the dependency tree. Assets can have multiple
 * parents that depend on it, and can be added to multiple output bundles.
 * The base Asset class doesn't do much by itself, but sets up an interface
 * for subclasses to implement.
 */
class Asset {
  id: number;
  name: string;
  basename: string;
  package: any;
  options: AssetOptions;
  encoding: string;
  type: string;
  processed: boolean;
  contents: any | null;
  ast: any | null;
  generated: any | null;
  hash: any | null;
  parentDeps: Set<any>;
  dependencies: Map<any, any>;
  depAssets: Map<any, any>;
  parentBundle: any | null;
  bundles: Set<any>;

  constructor(name: any, pkg: any, options: AssetOptions) {
    this.id = ASSET_ID++;
    this.name = name;
    this.basename = path.basename(this.name);
    this.package = pkg || {};
    this.options = options;
    this.encoding = 'utf8';
    this.type = path.extname(this.name).slice(1);

    this.processed = false;
    this.contents = null;
    this.ast = null;
    this.generated = null;
    this.hash = null;
    this.parentDeps = new Set();
    this.dependencies = new Map();
    this.depAssets = new Map();
    this.parentBundle = null;
    this.bundles = new Set();
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

  addDependency(name: string, opts: Object) {
    this.dependencies.set(name, Object.assign({name}, opts));
  }

  addURLDependency(url?: string, from: string = this.name, opts: Object) {
    if (!url || isURL(url)) {
      return url;
    }

    if (typeof from === 'object') {
      opts = from;
      from = this.name;
    }

    let resolved = path
      .resolve(path.dirname(from), url)
      .replace(/[\?#].*$/, '');
    this.addDependency(
      './' + path.relative(path.dirname(this.name), resolved),
      Object.assign({dynamic: true}, opts)
    );
    return this.options.parser
      .getAsset(resolved, this.package, this.options)
      .generateBundleName();
  }

  mightHaveDependencies() {
    return true;
  }

  async load() {
    return await fs.readFile(this.name, this.encoding);
  }

  parse(contents: any) {
    // do nothing by default
  }

  collectDependencies() {
    // do nothing by default
  }

  async pretransform() {}

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
      await this.loadIfNeeded();
      await this.pretransform();
      await this.getDependencies();
      await this.transform();
      this.generated = this.generate();
      this.hash = this.generateHash();
    }

    return this.generated;
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

  generateBundleName(isMainAsset: boolean) {
    // Resolve the main file of the package.json
    let main =
      this.package && this.package.main
        ? path.resolve(path.dirname(this.package.pkgfile), this.package.main)
        : null;
    let ext = '.' + this.type;

    // If this asset is main file of the package, use the package name
    if (this.name === main) {
      return this.package.name + ext;
    }

    // If this is the entry point of the root bundle, use the original filename
    if (isMainAsset) {
      return path.basename(this.name, path.extname(this.name)) + ext;
    }

    // Otherwise generate a unique name
    return md5(this.name) + ext;
  }

  generateErrorMessage(err: any) {
    return err;
  }
}

module.exports = Asset;
