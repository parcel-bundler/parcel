const fs = require('fs');
const {basename} = require('path');
const Packager = require('./Packager');

const prelude = fs
  .readFileSync(__dirname + '/../builtins/prelude.js', 'utf8')
  .trim();
const hmr = fs
  .readFileSync(__dirname + '/../builtins/hmr-runtime.js', 'utf8')
  .trim();

class JSPackager extends Packager {
  async start() {
    this.first = true;
    this.dedupe = new Map();

    await this.dest.write(prelude + '({');
  }

  async addAsset(asset) {
    if (this.dedupe.has(asset.generated.js)) {
      return;
    }

    // Don't dedupe when HMR is turned on since it messes with the asset ids
    if (!this.options.hmr) {
      this.dedupe.set(asset.generated.js, asset.id);
    }

    let deps = {};
    for (let dep of asset.dependencies.values()) {
      let mod = asset.depAssets.get(dep.name);

      // For dynamic dependencies, list the child bundles to load along with the module id
      if (dep.dynamic && this.bundle.childBundles.has(mod.parentBundle)) {
        let bundles = [basename(mod.parentBundle.name)];
        for (let child of mod.parentBundle.siblingBundles.values()) {
          if (!child.isEmpty) {
            bundles.push(basename(child.name));
          }
        }

        bundles.push(mod.id);
        deps[dep.name] = bundles;
      } else {
        deps[dep.name] = this.dedupe.get(mod.generated.js) || mod.id;
      }
    }

    await this.writeModule(asset.id, asset.generated.js, deps);
  }

  async writeModule(id, code, deps = {}) {
    let wrapped = this.first ? '' : ',';
    wrapped +=
      id + ':[function(require,module,exports) {\n' + (code || '') + '\n},';
    wrapped += JSON.stringify(deps);
    wrapped += ']';

    this.first = false;
    await this.dest.write(wrapped);
  }

  async end() {
    let entry = [];

    // Add the HMR runtime if needed.
    if (this.options.hmr) {
      // Asset ids normally start at 1, so this should be safe.
      await this.writeModule(
        0,
        hmr.replace('{{HMR_PORT}}', this.options.hmrPort)
      );
      entry.push(0);
    }

    // Load the entry module
    if (this.bundle.entryAsset) {
      entry.push(this.bundle.entryAsset.id);
    }

    await this.dest.end('},{},' + JSON.stringify(entry) + ')');
  }
}

module.exports = JSPackager;
