const Asset = require('../Asset');
const webmanifestTransform = require('../transforms/webmanifest');

class WebManifestAsset extends Asset {
  constructor(name, options) {
    super(name, options);
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

  async pretransform() {
    await webmanifestTransform(this);
  }

  generate() {
    return JSON.stringify(this.ast);
  }
}

module.exports = WebManifestAsset;
