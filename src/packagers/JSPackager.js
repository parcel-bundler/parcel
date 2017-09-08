const fs = require('fs');
const {basename} = require('path');
const Packager = require('./Packager');

const prelude = fs.readFileSync(__dirname + '/../builtins/prelude.js', 'utf8').trim();

class JSPackager extends Packager {
  async start() {
    this.first = true;
    this.dedupe = new Map;

    await this.dest.write(prelude + '({');
  }

  async addAsset(asset) {
    if (this.dedupe.has(asset.generated.js)) {
      return;
    }

    this.dedupe.set(asset.generated.js, asset.id);

    let wrapped = this.first ? '' : ',';
    wrapped += asset.id + ':[function(require,module,exports) {\n' + (asset.generated.js || '') + '\n},';

    let deps = {};
    for (let dep of asset.dependencies.values()) {
      let mod = asset.depAssets.get(dep.name);

      // For dynamic dependencies, list the child bundles to load along with the module id
      if (dep.dynamic && this.bundle.childBundles.has(mod.parentBundle)) {
        let bundles = [basename(mod.parentBundle.name)];
        for (let child of mod.parentBundle.typeBundleMap.values()) {
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

    wrapped += JSON.stringify(deps);
    wrapped += ']';

    this.first = false;
    await this.dest.write(wrapped);
  }

  async end() {
    // Load the entry module if this is the root bundle
    let entry = [];
    if (this.bundle.entryAsset) {
      entry.push(this.bundle.entryAsset.id);
    }

    await this.dest.end('},{},' + JSON.stringify(entry) + ')');
  }
}

module.exports = JSPackager;
