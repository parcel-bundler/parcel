const Packager = require('./Packager');
const posthtml = require('posthtml');
const path = require('path');
const urlJoin = require('../utils/urlJoin');

class HTMLPackager extends Packager {
  async addAsset(asset) {
    let html = asset.generated.html || '';

    // Find child bundles (e.g. JS) that have a sibling CSS bundle,
    // add them to the head so they are loaded immediately.
    let cssBundles = Array.from(this.bundle.childBundles)
      .map(b => b.siblingBundles.get('css'))
      .filter(Boolean);

    if (cssBundles.length > 0) {
      html = posthtml(this.insertCSSBundles.bind(this, cssBundles)).process(
        html,
        {sync: true}
      ).html;
    }

    await this.dest.write(html);
  }

  insertCSSBundles(cssBundles, tree) {
    let head = find(tree, 'head');
    if (!head) {
      let html = find(tree, 'html');
      head = {tag: 'head'};
      html.content.unshift(head);
    }

    if (!head.content) {
      head.content = [];
    }

    for (let bundle of cssBundles) {
      head.content.push({
        tag: 'link',
        attrs: {
          rel: 'stylesheet',
          href: urlJoin(this.options.publicURL, path.basename(bundle.name))
        }
      });
    }
  }
}

function find(tree, tag) {
  let res;
  tree.match({tag}, node => {
    res = node;
    return node;
  });

  return res;
}

module.exports = HTMLPackager;
