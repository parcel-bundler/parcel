const CSSAsset = require('./CSSAsset');
const path = require('path');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const md5 = require('../utils/md5');

const PROTOCOL_RE = /^[a-z]+:/;

class StylusAsset extends CSSAsset {
  async parse(code) {
    // stylus should be installed locally in the module that's being required
    let stylus = localRequire('stylus', this.name);
    let opts = this.package.stylus || await config.load(this.name, ['.stylusrc', '.stylusrc.js']);
    let style = stylus(code, opts);
    style.set('filename', this.name);

    // Setup a handler for the URL function so we add dependencies for linked assets.
    style.define('url', node => {
      let filename = node.val;
      if (!PROTOCOL_RE.test(filename)) {
        this.addDependency(filename);
        let resolved = path.resolve(path.dirname(this.name), filename);
        filename = md5(resolved) + path.extname(filename);
      }

      return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
    });

    return style;
  }

  collectDependencies() {
    for (let dep of this.ast.deps()) {
      this.addDependency(dep, {includedInParent: true});
    }
  }
}

module.exports = StylusAsset;
