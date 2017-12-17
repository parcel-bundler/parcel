const Asset = require('../Asset');
const isURL = require('../utils/is-url');
const url = require('url');
const path = require('path');

class WebManifestAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'webmanifest';
  }

  async parse(contents) {
    return JSON.parse(contents);
  }

  collectDependencies() {
    this.ast['icons'].map(icon => {
      if (icon.src) {
        let assetPath = this.addURLDependency(icon.src);
        if (!isURL(assetPath)) {
          assetPath = url.resolve(
            path.join(this.options.publicURL, assetPath),
            ''
          );
        }
        icon.src = assetPath;
      }
      return icon;
    });
  }

  generate() {
    return JSON.stringify(this.ast);
  }
}

module.exports = WebManifestAsset;
