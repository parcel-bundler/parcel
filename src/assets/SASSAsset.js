const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');
const path = require('path');
const os = require('os');

class SASSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'css';
  }

  async parse(code) {
    // node-sass should be installed locally in the module that's being required
    let sass = await localRequire('node-sass', this.name);
    let render = promisify(sass.render.bind(sass));

    let opts =
      this.package.sass ||
      (await this.getConfig(['.sassrc', '.sassrc.js'])) ||
      {};
    opts.includePaths = (opts.includePaths || []).concat(
      path.dirname(this.name)
    );
    opts.data = opts.data ? opts.data + os.EOL + code : code;
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

    return await render(opts);
  }

  collectDependencies() {
    for (let dep of this.ast.stats.includedFiles) {
      this.addDependency(dep, {includedInParent: true});
    }
  }

  generate() {
    return [
      {
        type: 'css',
        value: this.ast.css.toString(),
        hasDependencies: false
      }
    ];
  }
}

module.exports = SASSAsset;
