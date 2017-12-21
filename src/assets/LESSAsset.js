const CSSAsset = require('./CSSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');

class LESSAsset extends CSSAsset {
  async getConfig() {
    await super.getConfig();

    if (this.config.less) {
      return this.config;
    }

    this.config.less =
      this.package.less ||
      (await config.load(this.name, ['.lessrc', '.lessrc.js'])) ||
      {};
    this.config.less.filename = this.name;
    this.config.less.plugins = (this.config.less.plugins || []).concat(
      urlPlugin(this)
    );

    return this.config;
  }

  async parse(code) {
    // less should be installed locally in the module that's being required
    let less = localRequire('less', this.name);
    let render = promisify(less.render.bind(less));

    let res = await render(code, this.config.less);
    res.render = () => res.css;
    return res;
  }

  collectDependencies() {
    for (let dep of this.ast.imports) {
      this.addDependency(dep, {includedInParent: true});
    }
  }
}

function urlPlugin(asset) {
  return {
    install: (less, pluginManager) => {
      let visitor = new less.visitors.Visitor({
        visitUrl: (node) => {
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
