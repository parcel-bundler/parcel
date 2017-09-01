const CSSAsset = require('./CSSAsset');
const path = require('path');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

class StylusAsset extends CSSAsset {
  async load() {
    this.config = this.package.stylus || await config.load(this.name, ['.stylusrc', '.stylusrc.js']);
    return super.load();
  }

  parse(code) {
    // stylus should be installed locally in the module that's being required
    let stylus = localRequire('stylus', this.name);
    let style = stylus(code, this.config);
    style.set('filename', this.name);
    return style;
  }

  collectDependencies() {
    for (let dep of this.ast.deps()) {
      this.addDependency(dep, {includedInParent: true});
    }
  }

  generate() {
    return {
      css: this.ast.render(),
      js: ''
    };
  }
}

module.exports = StylusAsset;
