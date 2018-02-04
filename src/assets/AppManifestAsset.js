const Asset = require('../Asset');

class AppManifestAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'json';
  }

  parse(content) {
    return JSON.parse(content);
  }

  collectDependencies() {
    if ('icons' in this.ast) {
      for (let icon of this.ast.icons) {
        let path = this.addURLDependency(icon.src);
        icon.src = path;
      }
    }
  }

  generate() {
    return {
      json: JSON.stringify(this.ast)
    };
  }
}

module.exports = AppManifestAsset;
