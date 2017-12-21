const CSSAsset = require('./CSSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');
const path = require('path');

class SASSAsset extends CSSAsset {
  async parse(code) {
    // node-sass should be installed locally in the module that's being required
    let sass = await localRequire('node-sass', this.name);
    let render = promisify(sass.render.bind(sass));

    let opts =
      this.package.sass ||
      (await config.load(this.name, ['.sassrc', '.sassrc.js'])) ||
      {};
    opts.includePaths = (opts.includePaths || []).concat(
      path.dirname(this.name)
    );
    opts.data = code;
    opts.indentedSyntax =
      typeof opts.indentedSyntax === 'boolean'
        ? opts.indentedSyntax
        : path.extname(this.name).toLowerCase() === '.sass';

    opts.functions = Object.assign({}, opts.functions, {
      url: node => {
        let filename = this.addURLDependency(node.getValue());
        return new sass.types.String(`url(${JSON.stringify(filename)})`);
      }
    });

    let res = await render(opts);
    res.render = () => res.css.toString();
    return res;
  }

  collectDependencies() {
    for (let dep of this.ast.stats.includedFiles) {
      this.addDependency(dep, {includedInParent: true});
    }
  }
}

module.exports = SASSAsset;
