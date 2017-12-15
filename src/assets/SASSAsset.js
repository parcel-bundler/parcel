const CSSAsset = require('./CSSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');
const path = require('path');

class SASSAsset extends CSSAsset {
  async getConfig() {
    await super.getConfig();

    if (this.config.sass) {
      return this.config;
    }

    this.config.sass =
      this.package.sass ||
      (await config.load(this.name, ['.sassrc', '.sassrc.js'])) ||
      {};
    this.config.sass.includePaths = (
      this.config.sass.includePaths || []
    ).concat(path.dirname(this.name));

    this.config.sass.indentedSyntax =
      typeof this.config.sass.indentedSyntax === 'boolean'
        ? this.config.sass.indentedSyntax
        : path.extname(this.name).toLowerCase() === '.sass';

    return this.config;
  }

  async parse(code) {
    // node-sass should be installed locally in the module that's being required
    let sass = localRequire('node-sass', this.name);
    let render = promisify(sass.render.bind(sass));

    await this.getConfig();

    let opts = this.config.sass;
    opts.data = code;

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
