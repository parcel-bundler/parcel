const Packager = require('./Packager');
const {minify} = require('uglify-es');
const path = require('path');
const fs = require('fs');

const SourceMap = require('../SourceMap');
const concat = require('../transforms/concat');
const lineCounter = require('../utils/lineCounter');
const urlJoin = require('../utils/urlJoin');

const prelude = fs
  .readFileSync(path.join(__dirname, '../builtins/prelude2.js'), 'utf8')
  .trim();
const helpers =
  fs
    .readFileSync(path.join(__dirname, '../builtins/helpers.js'), 'utf8')
    .trim() + '\n';

class JSConcatPackager extends Packager {
  write(string, lineCount = lineCounter(string)) {
    this.lineOffset += lineCount - 1;
    this.contents += string;
  }

  async start() {
    this.addedAssets = new Set();
    this.exposedModules = new Set();
    this.contents = '';
    this.lineOffset = 1;
    this.exports = new Map();
    this.wildcards = new Map();
    this.moduleMap = new Map();
    this.needsPrelude = false;

    for (let asset of this.bundle.assets) {
      // If this module is referenced by another bundle, it needs to be exposed externally.
      let isExposed = !Array.from(asset.parentDeps).every(dep =>
        this.bundle.assets.has(this.bundler.loadedAssets.get(dep.parent))
      );

      if (
        isExposed ||
        (this.bundle.entryAsset === asset &&
          this.bundle.parentBundle &&
          this.bundle.parentBundle.childBundles.size !== 1)
      ) {
        this.exposedModules.add(asset);
        this.needsPrelude = true;
      }

      for (let mod of asset.depAssets.values()) {
        if (!this.bundle.assets.has(mod)) {
          this.needsPrelude = true;
          break;
        }
      }
    }

    if (this.needsPrelude) {
      if (this.bundle.entryAsset) {
        this.exposedModules.add(this.bundle.entryAsset);
      }

      this.write(prelude + '(function (require) {\n' + helpers);
    } else {
      this.write('(function () {\n' + helpers);
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
    let {js, map} = asset.generated;

    this.moduleMap.set(asset.id, asset);
    this.wildcards.set(asset.id, asset.cacheData.wildcards);

    for (let key in asset.cacheData.exports) {
      let local = '$' + asset.id + '$export$' + asset.cacheData.exports[key];
      if (key !== local) {
        this.exports.set(key, local);
      }
    }

    for (let [dep, mod] of asset.depAssets) {
      if (dep.dynamic && this.bundle.childBundles.has(mod.parentBundle)) {
        for (let child of mod.parentBundle.siblingBundles) {
          if (!child.isEmpty) {
            await this.addBundleLoader(child.type);
          }
        }

        await this.addBundleLoader(mod.type);
      }
    }

    js = js.trim() + '\n';

    this.bundle.addOffset(asset, this.lineOffset + 1);
    this.write(
      `\n/* ASSET: ${asset.id} - ${path.relative(
        this.options.rootDir,
        asset.name
      )} */\n${js}`,
      map && map.lineCount ? map.lineCount : undefined
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
      let target = this.options.target === 'node' ? 'node' : 'browser';
      let asset = await this.bundler.getAsset(loader[target]);
      if (!this.bundle.assets.has(asset)) {
        await this.addAssetToBundle(asset);
        this.write(
          `${this.getExportIdentifier(bundleLoader)}.register(${JSON.stringify(
            bundleType
          )},${this.getExportIdentifier(asset)});\n`
        );
      }
    }
  }

  async end() {
    if (this.needsPrelude) {
      let exposed = [];
      let prepareModule = [];
      for (let m of this.exposedModules) {
        if (m.cacheData.isES6Module) {
          prepareModule.push(
            `${this.getExportIdentifier(m)}.__esModule = true;`
          );
        }

        exposed.push(`${m.id}: ${this.getExportIdentifier(m)}`);
      }

      this.write(`
        ${prepareModule.join('\n')}
        return {${exposed.join(', ')}};
      })`);
    } else {
      this.write('})();');
    }

    let result = concat(this);
    let {sourceMaps} = this.options;
    let {code: output, rawMappings} = result;

    if (sourceMaps && rawMappings) {
      this.bundle.extendSourceMap(
        new SourceMap(rawMappings, {
          [this.bundle.name]: this.contents
        })
      );
    }

    if (this.options.minify) {
      let opts = {
        warnings: true,
        compress: {
          passes: 3,
          unsafe: true,
          pure_getters: true
        },
        mangle: {
          eval: true
        }
      };

      if (sourceMaps) {
        let sourceMap = new SourceMap();

        opts.output = {
          source_map: {
            add(source, gen_line, gen_col, orig_line, orig_col, name) {
              sourceMap.addMapping({
                source,
                name,
                original: {
                  line: orig_line,
                  column: orig_col
                },
                generated: {
                  line: gen_line,
                  column: gen_col
                }
              });
            }
          }
        };

        this.bundle.extendSourceMap(sourceMap);
      }

      let result = minify(output, opts);

      if (result.error) {
        throw result.error;
      }

      output = result.code;
    }

    if (sourceMaps) {
      // Add source map url if a map bundle exists
      let mapBundle = this.bundle.siblingBundlesMap.get('map');
      if (mapBundle) {
        output += `\n//# sourceMappingURL=${urlJoin(
          this.options.publicURL,
          path.basename(mapBundle.name)
        )}`;
      }
    }

    await super.write(output);
  }
}

module.exports = JSConcatPackager;
