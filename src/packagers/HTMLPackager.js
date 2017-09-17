const Packager = require('./Packager');
const posthtml = require('posthtml');
const path = require('path');

class HTMLPackager extends Packager {
  async addAsset(asset) {
    let html = asset.generated.html || '';

    // Find child bundles (e.g. JS) that have a sibling CSS bundle,
    // add add them to the head so they are loaded immediately.
    let cssBundles = Array.from(this.bundle.childBundles)
      .map(b => b.siblingBundles.get('css'))
      .filter(Boolean);

    if (cssBundles.length > 0) {
      html = posthtml(this.insertCSSBundles.bind(this, cssBundles))
        .process(html, {sync: true}).html;
    }

    await this.dest.write(html);
  }

  insertCSSBundles(cssBundles, tree) {
    tree.match({tag: 'head'}, head => {
      for (let bundle of cssBundles) {
        head.content.push({
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: path.join(this.options.publicURL, path.basename(bundle.name))
          }
        });
      }

      return head;
    });
  }
}

module.exports = HTMLPackager;
