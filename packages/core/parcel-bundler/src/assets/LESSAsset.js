const CSSAsset = require('./CSSAsset');
const path = require('path');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');

class LESSAsset extends CSSAsset {
  async parse(code) {
    // less should be installed locally in the module that's being required
    let less = localRequire('less', this.name);
    let render = promisify(less.render.bind(less));

    let opts = this.package.less || await config.load(this.name, ['.lessrc', '.lessrc.js']) || {};
    opts.filename = this.name;

    let res = await render(code, opts);
    res.render = () => res.css;
    return res;
  }

  collectDependencies() {
    for (let dep of this.ast.imports) {
      this.addDependency(dep, {includedInParent: true});
    }
  }
}

module.exports = LESSAsset;
