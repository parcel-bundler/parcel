const path = require('path');
const Packager = require('./Packager');
const getExisting = require('../utils/getExisting');
const urlJoin = require('../utils/urlJoin');
const lineCounter = require('../utils/lineCounter');
const objectHash = require('../utils/objectHash');

const prelude = getExisting(
  path.join(__dirname, '../builtins/prelude.min.js'),
  path.join(__dirname, '../builtins/prelude.js')
);

class JSPackager extends Packager {
  async start() {
    this.first = true;
    this.dedupe = new Map();
    this.bundleLoaders = new Set();
    this.externalModules = new Set();

    let preludeCode = this.options.minify ? prelude.minified : prelude.source;
    if (this.options.target === 'electron') {
      preludeCode =
        `process.env.HMR_PORT=${
          this.options.hmrPort
        };process.env.HMR_HOSTNAME=${JSON.stringify(
          this.options.hmrHostname
        )};` + preludeCode;
    }
    await this.write(preludeCode + '({');
    this.lineOffset = lineCounter(preludeCode);
  }

  async addAsset(asset) {
    // If this module is referenced by another JS bundle, it needs to be exposed externally.
    // In that case, don't dedupe the asset as it would affect the module ids that are referenced by other bundles.
    let isExposed = !Array.from(asset.parentDeps).every(dep => {
      let depAsset = this.bundler.loadedAssets.get(dep.parent);
      return this.bundle.assets.has(depAsset) || depAsset.type !== 'js';
    });

    if (!isExposed) {
      let key = this.dedupeKey(asset);
      if (this.dedupe.has(key)) {
        return;
      }

      // Don't dedupe when HMR is turned on since it messes with the asset ids
      if (!this.options.hmr) {
        this.dedupe.set(key, asset.id);
      }
    }

    let deps = {};
    for (let [dep, mod] of asset.depAssets) {
      // For dynamic dependencies, list the child bundles to load along with the module id
      if (dep.dynamic) {
        let bundles = [this.getBundleSpecifier(mod.parentBundle)];
        for (let child of mod.parentBundle.siblingBundles) {
          if (!child.isEmpty) {
            bundles.push(this.getBundleSpecifier(child));
            this.bundleLoaders.add(child.type);
          }
        }

        bundles.push(mod.id);
        deps[dep.name] = bundles;
        this.bundleLoaders.add(mod.type);
      } else {
        deps[dep.name] = this.dedupe.get(this.dedupeKey(mod)) || mod.id;

        // If the dep isn't in this bundle, add it to the list of external modules to preload.
        // Only do this if this is the root JS bundle, otherwise they will have already been
        // loaded in parallel with this bundle as part of a dynamic import.
        if (!this.bundle.assets.has(mod)) {
          this.externalModules.add(mod);
          if (
            !this.bundle.parentBundle ||
            this.bundle.isolated ||
            this.bundle.parentBundle.type !== 'js'
          ) {
            this.bundleLoaders.add(mod.type);
          }
        }
      }
    }

    this.bundle.addOffset(asset, this.lineOffset);
    await this.writeModule(
      asset.id,
      asset.generated.js,
      deps,
      asset.generated.map
    );
  }

  getBundleSpecifier(bundle) {
    let name = path.basename(bundle.name);
    if (bundle.entryAsset) {
      return [name, bundle.entryAsset.id];
    }

    return name;
  }

  dedupeKey(asset) {
    // cannot rely *only* on generated JS for deduplication because paths like
    // `../` can cause 2 identical JS files to behave differently depending on
    // where they are located on the filesystem
    let deps = Array.from(asset.depAssets.values(), dep => dep.name).sort();
    return objectHash([asset.generated.js, deps]);
  }

  async writeModule(id, code, deps = {}, map) {
    let wrapped = this.first ? '' : ',';
    wrapped +=
      JSON.stringify(id) +
      ':[function(require,module,exports) {\n' +
      (code || '') +
      '\n},';
    wrapped += JSON.stringify(deps);
    wrapped += ']';

    this.first = false;
    await this.write(wrapped);

    // Use the pre-computed line count from the source map if possible
    let lineCount = map && map.lineCount ? map.lineCount : lineCounter(code);
    this.lineOffset += 1 + lineCount;
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
      await this.addAssetToBundle(child);
    }

    await this.addAsset(asset);
  }

  async writeBundleLoaders() {
    if (this.bundleLoaders.size === 0) {
      return false;
    }

    let bundleLoader = this.bundler.loadedAssets.get(
      require.resolve('../builtins/bundle-loader')
    );
    if (this.externalModules.size > 0 && !bundleLoader) {
      bundleLoader = await this.bundler.getAsset('_bundle_loader');
    }

    if (bundleLoader) {
      await this.addAssetToBundle(bundleLoader);
    } else {
      return;
    }

    // Generate a module to register the bundle loaders that are needed
    let loads = 'var b=require(' + JSON.stringify(bundleLoader.id) + ');';
    for (let bundleType of this.bundleLoaders) {
      let loader = this.options.bundleLoaders[bundleType];
      if (loader) {
        let target = this.options.target === 'node' ? 'node' : 'browser';
        let asset = await this.bundler.getAsset(loader[target]);
        await this.addAssetToBundle(asset);
        loads +=
          'b.register(' +
          JSON.stringify(bundleType) +
          ',require(' +
          JSON.stringify(asset.id) +
          '));';
      }
    }

    // Preload external modules before running entry point if needed
    if (this.externalModules.size > 0) {
      let preload = [];
      for (let mod of this.externalModules) {
        // Find the bundle that has the module as its entry point
        let bundle = Array.from(mod.bundles).find(b => b.entryAsset === mod);
        if (bundle) {
          preload.push([path.basename(bundle.name), mod.id]);
        }
      }

      loads += 'b.load(' + JSON.stringify(preload) + ')';
      if (this.bundle.entryAsset) {
        loads += `.then(function(){require(${JSON.stringify(
          this.bundle.entryAsset.id
        )});})`;
      }

      loads += ';';
    }

    // Asset ids normally start at 1, so this should be safe.
    await this.writeModule(0, loads, {});
    return true;
  }

  async end() {
    let entry = [];

    // Add the HMR runtime if needed.
    if (this.options.hmr) {
      let asset = await this.bundler.getAsset(
        require.resolve('../builtins/hmr-runtime')
      );
      await this.addAssetToBundle(asset);
      entry.push(asset.id);
    }

    if (await this.writeBundleLoaders()) {
      entry.push(0);
    }

    if (this.bundle.entryAsset && this.externalModules.size === 0) {
      entry.push(this.bundle.entryAsset.id);
    }

    await this.dest.write(
      '},{},' +
        JSON.stringify(entry) +
        ', ' +
        JSON.stringify(this.options.global || null) +
        ')'
    );
    if (this.options.sourceMaps) {
      // Add source map url if a map bundle exists
      let mapBundle = this.bundle.siblingBundlesMap.get('map');
      if (mapBundle) {
        let mapUrl = urlJoin(
          this.options.publicURL,
          path.basename(mapBundle.name)
        );
        await this.write(`\n//# sourceMappingURL=${mapUrl}`);
      }
    }
    await this.dest.end();
  }
}

module.exports = JSPackager;
