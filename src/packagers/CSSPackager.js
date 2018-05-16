const path = require('path');
const Packager = require('./Packager');
const urlJoin = require('../utils/urlJoin');

class CSSPackager extends Packager {
  async addAsset(asset) {
    let css = asset.generated.css || '';

    // Figure out which media types this asset was imported with.
    // We only want to import the asset once, so group them all together.
    let media = [];
    for (let dep of asset.parentDeps) {
      if (!dep.media) {
        // Asset was imported without a media type. Don't wrap in @media.
        media.length = 0;
        break;
      } else {
        media.push(dep.media);
      }
    }

    // If any, wrap in an @media block
    if (media.length) {
      css = `@media ${media.join(', ')} {\n${css.trim()}\n}\n`;
    }

    await this.write(css);
  }

  async end() {
    if (this.options.sourceMaps) {
      let mapBundle = this.bundle.siblingBundlesMap.get('map');
      if (mapBundle) {
        await this.write(
          `\n/*# sourceMappingURL=${urlJoin(
            this.options.publicURL,
            path.basename(mapBundle.name)
          )}*/`
        );
      }
    }
  }
}

module.exports = CSSPackager;
