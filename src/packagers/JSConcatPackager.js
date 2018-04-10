const Packager = require('./Packager');
const t = require('babel-types');
const path = require('path');
const fs = require('fs');

const concat = require('../transforms/concat');

const prelude = fs
  .readFileSync(path.join(__dirname, '../builtins/prelude2.js'), 'utf8')
  .trim();

class JSConcatPackager extends Packager {
  async write(string) {
    this.buffer += string;
  }

  async start() {
    this.addedAssets = new Set();
    this.exposedModules = new Set();
    this.buffer = '';
    this.exports = new Map();
    this.wildcards = new Map();
    this.moduleMap = new Map();

    for (let asset of this.bundle.assets) {
      // If this module is referenced by another bundle, it needs to be exposed externally.
      let isExposed = !Array.from(asset.parentDeps).every(dep =>
        this.bundle.assets.has(this.bundler.loadedAssets.get(dep.parent))
      );

      if (
        isExposed ||
        (this.bundle.entryAsset === asset && this.bundle.parentBundle)
      ) {
        this.exposedModules.add(asset);
      }
    }

    if (this.exposedModules.size > 0) {
      await this.write(prelude + '(function (require) {\n');
    } else {
      await this.write('(function () {\n');
    }
  }

  getExportIdentifier(asset) {
    return '$' + asset.id + '$exports';
  }

  async addAsset(asset) {
    if (this.addedAssets.has(asset)) {
      return;
    }

    this.addedAssets.add(asset);
    let js = asset.generated.js;

    this.moduleMap.set(asset.id, asset);
    this.wildcards.set(asset.id, asset.cacheData.wildcards);

    for (let key in asset.cacheData.exports) {
      let local = '$' + asset.id + '$export$' + asset.cacheData.exports[key];
      if (key !== local) {
        this.exports.set(key, local);
      }
    }

    for (let [dep, mod] of asset.depAssets) {
      let depName = '$' + asset.id + '$require$' + t.toIdentifier(dep.name);
      let moduleName = this.getExportIdentifier(mod);

      // If this module is not in the current bundle, generate a `require` call for it.
      if (!this.bundle.assets.has(mod)) {
        moduleName = `require(${mod.id})`;
      }

      js = js.split(depName).join(moduleName);

      // If this was an ES6 export all (e.g. export * from 'foo'), resolve to the original exports.
      if (dep.isExportAll) {
        for (let exp in mod.cacheData.exports) {
          let id = mod.cacheData.exports[exp];
          if (id !== 'default') {
            let key = '$' + asset.id + '$export$' + id;
            asset.cacheData.exports[key] = id;
            this.exports.set(
              key,
              this.exports.get('$' + mod.id + '$export$' + id) || exp
            );
          }
        }
      }

      if (dep.isES6Import) {
        if (mod.cacheData.isES6Module) {
          js = js
            .split('$' + asset.id + '$import$' + t.toIdentifier(dep.name))
            .join('$' + mod.id + '$export');
        } else {
          js = js
            .split(
              '$' +
                asset.id +
                '$import$' +
                t.toIdentifier(dep.name) +
                '$default'
            )
            .join('$' + mod.id + '$exports');
          js = js
            .split('$' + asset.id + '$import$' + t.toIdentifier(dep.name) + '$')
            .join('$' + mod.id + '$exports.');
        }
      }

      let depResolve =
        '$' + asset.id + '$require_resolve$' + t.toIdentifier(dep.name);
      let resolved = '' + mod.id;

      if (dep.dynamic && this.bundle.childBundles.has(mod.parentBundle)) {
        let bundles = [this.getBundleSpecifier(mod.parentBundle)];
        for (let child of mod.parentBundle.siblingBundles) {
          if (!child.isEmpty) {
            bundles.push(this.getBundleSpecifier(child));
            await this.addBundleLoader(child.type);
          }
        }

        bundles.push(mod.id);
        resolved = JSON.stringify(bundles);
        await this.addBundleLoader(mod.type);
      }

      js = js.split(depResolve).join(resolved);
    }

    // Replace all re-exported variables

    js = js.trim() + '\n';

    await this.write(
      `\n/* ASSET: ${asset.id} - ${path.relative(
        this.options.rootDir,
        asset.name
      )} */\n${js}`
    );
  }

  getBundleSpecifier(bundle) {
    let name = path.basename(bundle.name);
    if (bundle.entryAsset) {
      return [name, bundle.entryAsset.id];
    }

    return name;
  }

  async addAssetToBundle(asset) {
    if (this.bundle.assets.has(asset)) {
      return;
    }
    this.bundle.addAsset(asset);
    if (!asset.parentBundle) {
      asset.parentBundle = this.bundle;
    }

    // Add all dependencies as well
    for (let child of asset.depAssets.values()) {
      await this.addAssetToBundle(child, this.bundle);
    }

    await this.addAsset(asset);
  }

  async addBundleLoader(bundleType) {
    let bundleLoader = this.bundler.loadedAssets.get(
      require.resolve('../builtins/bundle-loader')
    );
    if (!bundleLoader) {
      bundleLoader = await this.bundler.getAsset('_bundle_loader');
    }

    if (bundleLoader) {
      await this.addAssetToBundle(bundleLoader);
    } else {
      return;
    }

    let loader = this.options.bundleLoaders[bundleType];
    if (loader) {
      let asset = await this.bundler.getAsset(loader);
      if (!this.bundle.assets.has(asset)) {
        await this.addAssetToBundle(asset);
        await this.write(
          `${this.getExportIdentifier(bundleLoader)}.register(${JSON.stringify(
            bundleType
          )},${this.getExportIdentifier(asset)});\n`
        );
      }
    }
  }

  async end() {
    if (this.exposedModules.size > 0) {
      let exposed = [];
      for (let m of this.exposedModules) {
        exposed.push(`${m.id}: ${this.getExportIdentifier(m)}`);
      }

      await this.write(`return {${exposed.join(', ')}};\n`);
    } else {
      await this.write('})();');
    }

    super.write(
      concat(this.buffer, this.exports, this.moduleMap, this.wildcards)
    );
  }
}

module.exports = JSConcatPackager;
