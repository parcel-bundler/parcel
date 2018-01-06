const Packager = require('./Packager');
const posthtml = require('posthtml');
const path = require('path');
const urlJoin = require('../utils/urlJoin');

class HTMLPackager extends Packager {
  async addAsset(asset) {
    let html = asset.generated.html || '';

    // Find child bundles that have JS or CSS sibling bundles,
    // add them to the head so they are loaded immediately.
    let siblingBundles = Array.from(this.bundle.childBundles)
      .reduce((p, b) => p.concat([...b.siblingBundles.values()]), [])
      .filter(b => b.type === 'css' || b.type === 'js');

    if (siblingBundles.length > 0) {
      html = posthtml(
        this.insertSiblingBundles.bind(this, siblingBundles)
      ).process(html, {sync: true}).html;
    }

    await this.dest.write(html);
  }

  getHeadContent(tree) {
    let head = find(tree, 'head');
    if (!head) {
      let html = find(tree, 'html');
      head = {tag: 'head'};
      html.content.unshift(head);
    }

    if (!head.content) {
      head.content = [];
    }

    return head;
  }

  insertSiblingBundles(siblingBundles, tree) {
    let head = this.getHeadContent(tree);

    for (let bundle of siblingBundles) {
      if (bundle.type === 'css') {
        head.content.push({
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: urlJoin(this.options.publicURL, path.basename(bundle.name))
          }
        });
      } else if (bundle.type === 'js') {
        head.content.push({
          tag: 'script',
          attrs: {
            src: urlJoin(this.options.publicURL, path.basename(bundle.name))
          }
        });
      }
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
