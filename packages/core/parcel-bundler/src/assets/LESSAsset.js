const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');

class LESSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'css';
  }

  async parse(code) {
    // less should be installed locally in the module that's being required
    let less = await localRequire('less', this.name);
    let render = promisify(less.render.bind(less));

    let opts = Object.assign(
      {},
      this.package.less || (await this.getConfig(['.lessrc', '.lessrc.js']))
    );
    opts.filename = this.name;
    opts.plugins = (opts.plugins || []).concat(urlPlugin(this));

    return await render(code, opts);
  }

  collectDependencies() {
    for (let dep of this.ast.imports) {
      this.addDependency(dep, {includedInParent: true});
    }
  }

  generate() {
    return [
      {
        type: 'css',
        value: this.ast ? this.ast.css : '',
        hasDependencies: false
      }
    ];
  }
}

function urlPlugin(asset) {
  return {
    install: (less, pluginManager) => {
      let visitor = new less.visitors.Visitor({
        visitUrl: node => {
          node.value.value = asset.addURLDependency(
            node.value.value,
            node.currentFileInfo.filename
          );
          return node;
        }
      });

      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);
    }
  };
}

module.exports = LESSAsset;
