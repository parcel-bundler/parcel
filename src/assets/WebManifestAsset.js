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
    if (Array.isArray(this.ast.icons)) {
      for (let icon of this.ast.icons) {
        icon.src = this.addURLDependency(icon.src);
      }
    }

    if (Array.isArray(this.ast.screenshots)) {
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
    return JSON.stringify(this.ast);
  }
}

module.exports = WebManifestAsset;
