const CSSAsset = require('./CSSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

class StylusAsset extends CSSAsset {
  async parse(code) {
    // stylus should be installed locally in the module that's being required
    let stylus = localRequire('stylus', this.name);
    let opts = this.package.stylus || await config.load(this.name, ['.stylusrc', '.stylusrc.js']);
    let style = stylus(code, opts);
    style.set('filename', this.name);

    // Setup a handler for the URL function so we add dependencies for linked assets.
    style.define('url', node => {
      let filename = this.addURLDependency(node.val, node.filename);
      return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
    });

    return style;
  }

  collectDependencies() {
    for (let dep of this.ast.deps()) {
      this.addDependency(dep, {includedInParent: true});
    }
  }

  generateErrorMessage(err) {
    let index = err.message.indexOf('\n');
    err.codeFrame = err.message.slice(index + 1);
    err.message = err.message.slice(0, index);
    return err;
  }
}

module.exports = StylusAsset;
