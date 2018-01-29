const Asset = require('../Asset');

class WebManifestAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'webmanifest';
  }

  parse(content) {
    return JSON.parse(content);
  }

  collectDependencies() {
    if ('icons' in this.ast) {
      for (let icon of this.ast.icons) {
        icon.src = this.addURLDependency(icon.src);
      }
    }
    if ('screenshots' in this.ast) {
      for (let shot of this.ast.screenshots) {
        shot.src = this.addURLDependency(shot.src);
      }
    }
    if (this.ast.serviceworker && this.ast.serviceworker.src) {
      this.ast.serviceworker.src = this.addURLDependency(
        this.ast.serviceworker.src
      );
    }
  }

  generate() {
    return {
      webmanifest: JSON.stringify(this.ast)
    };
  }
}

module.exports = WebManifestAsset;
