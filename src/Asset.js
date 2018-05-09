const URL = require('url');
const path = require('path');
const fs = require('./utils/fs');
const objectHash = require('./utils/objectHash');
const md5 = require('./utils/md5');
const isURL = require('./utils/is-url');
const config = require('./utils/config');
const syncPromise = require('./utils/syncPromise');
const logger = require('./Logger');
const Polymorph = require('./utils/Polymorph');

// lazy require it to prevent circual deps
let localRequire;
let ASSET_ID = 1;

/**
 * An Asset represents a file in the dependency tree. Assets can have multiple
 * parents that depend on it, and can be added to multiple output bundles.
 * The base Asset class doesn't do much by itself, but sets up an interface
 * for subclasses to implement.
 */
class Asset {
  constructor(name, options) {
    this.id = ASSET_ID++;
    this.name = name;
    this.basename = path.basename(this.name);
    this.relativeName = path.relative(options.rootDir, this.name);
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

    this.init(name, options);
  }

  require(name) {
    if (!localRequire) {
      localRequire = require('./utils/localRequire');
    }

    return localRequire(name, this.name);
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
    return this.ast;
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
      await this.collectDependencies(this.ast);
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
      .getAsset(resolved, this.options)
      .generateBundleName();

    return URL.format(parsed);
  }

  get package() {
    logger.warn(
      '`asset.package` is deprecated. Please use `await asset.getPackage()` instead.'
    );
    return syncPromise(this.getPackage());
  }

  async getPackage() {
    if (!this._package) {
      this._package = await this.getConfig(['package.json']);
    }

    return this._package;
  }

  async getConfig(filenames, opts = {}) {
    if (opts.packageKey) {
      let pkg = await this.getPackage();
      if (pkg && pkg[opts.packageKey]) {
        return pkg[opts.packageKey];
      }
    }

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

  async process() {
    if (!this.generated) {
      await this.loadIfNeeded();
      await this.pretransform(this.ast);
      await this.getDependencies(this.ast);
      await this.transform(this.ast);
      this.generated = await this.generate(this.ast);
      this.hash = await this.generateHash();
    }

    return this.generated;
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
}

let reduce = (a, b) => a || b;
let noop = x => x;

function map(ast) {
  if (typeof ast === 'undefined') {
    return ast;
  } else {
    return (this.ast = ast);
  }
}

Polymorph(Asset, {
  unique: [
    'parse',
    {
      name: 'load',
      default() {
        return fs.readFile(this.name, this.encoding);
      }
    },
    {
      // TODO: move to postProcess and generate to morphMultiple
      name: 'postProcess',
      default: noop
    },
    {
      name: 'generate',
      default() {
        return {
          [this.type]: this.contents
        };
      }
    }
  ],
  multiple: [
    {
      name: 'init',
      async: true
    },
    {
      name: 'collectDependencies',
      async: true
    },
    {
      name: 'generateHash',
      async: true,
      seed: '',
      reduce: (acc, hash) => {
        if (hash) {
          return hash;
        }

        return acc;
      },
      default() {
        if (this.generated) {
          return objectHash(this.generated);
        }
      }
    },
    {
      name: 'pretransform',
      async: true,
      map
    },
    {
      name: 'transform',
      async: true,
      map
    },
    {
      name: 'shouldInvalidate',
      seed: false,
      reduce
    },
    {
      name: 'mightHaveDependencies',
      seed: false,
      default: () => true,
      reduce
    },
    {
      name: 'generateErrorMessage',
      default: noop,
      reduce
    }
  ]
});

module.exports = Asset;
