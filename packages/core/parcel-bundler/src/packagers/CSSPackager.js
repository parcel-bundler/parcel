const path = require('path');
const Packager = require('./Packager');
const lineCounter = require('../utils/lineCounter');
const urlJoin = require('../utils/urlJoin');

class CSSPackager extends Packager {
  async start() {
    this.lineOffset = 0;
    this.columnOffset = 0;
  }

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

    if (asset.options.sourceMaps) {
      let lineCount = lineCounter(css);

      if (lineCount == 1) {
        this.bundle.addOffset(asset, this.lineOffset, this.columnOffset);
        await this.write(css);
        this.columnOffset += css.length;
      } else {
        const lines = css.split('\n');
        if (this.columnOffset == 0) {
          this.bundle.addOffset(asset, this.lineOffset, 0);
          await this.write(css + '\n');
        } else {
          this.columnOffset = 0;
          this.bundle.addOffset(asset, this.lineOffset + 1, 0);
          this.columnOffset = lines[lines.length - 1].length;
          await this.write('\n' + css);
        }
        this.lineOffset += lineCount;
      }
    } else {
      await this.write(css);
    }
  }

  async end() {
    if (this.options.sourceMaps) {
      // Add source map url if a map bundle exists
      let mapBundle = this.bundle.siblingBundlesMap.get('map');
      if (mapBundle) {
        let mapUrl = urlJoin(
          this.options.publicURL,
          path.basename(mapBundle.name)
        );
        await this.write(`\n/*# sourceMappingURL=${mapUrl} */`);
      }
    }
    await super.end();
  }
}

module.exports = CSSPackager;
