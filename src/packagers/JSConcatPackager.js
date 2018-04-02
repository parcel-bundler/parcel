const Packager = require('./Packager');
const t = require('babel-types');

class JSConcatPackager extends Packager {
  async start() {
    await this.write('(function () {\n');
  }

  async addAsset(asset) {
    let js = asset.generated.js;

    for (let [dep, mod] of asset.depAssets) {
      let depName = '$' + asset.id + '$require$' + t.toIdentifier(dep.name);
      let moduleName = '$' + mod.id + '$exports';
      js = js.split(depName).join(moduleName);
    }

    js = js.trim() + '\n';

    await this.write(js);
  }

  async end() {
    await this.write('})();');
  }
}

module.exports = JSConcatPackager;
