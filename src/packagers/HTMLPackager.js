const Packager = require('./Packager');
const fs = require('../utils/fs');
const posthtml = require('posthtml');
const path = require('path');
const urlJoin = require('../utils/urlJoin');
const url = require('url');

// https://www.w3.org/TR/html5/dom.html#metadata-content-2
const metadataContent = new Set([
  'base',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title'
]);

class HTMLPackager extends Packager {
  setup() {}

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

    // Use the bundle name if this is the entry asset, otherwise generate one.
    let name = this.bundle.name;
    if (asset !== this.bundle.entryAsset) {
      name = url.resolve(
        path.join(path.dirname(this.bundle.name), asset.generateBundleName()),
        ''
      );
    }

    this.size = html.length;
    await fs.writeFile(name, html);
  }

  getSize() {
    return this.size || 0;
  }

  end() {}

  addBundlesToTree(bundles, tree) {
    const head = find(tree, 'head');
    if (head) {
      const content = head.content || (head.content = []);
      content.push(...bundles);
      return;
    }

    const html = find(tree, 'html');
    const content = html ? html.content || (html.content = []) : tree;
    const index = findBundleInsertIndex(content);

    content.splice(index, 0, ...bundles);
  }

  insertSiblingBundles(siblingBundles, tree) {
    const bundles = [];

    for (let bundle of siblingBundles) {
      if (bundle.type === 'css') {
        bundles.push({
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: urlJoin(this.options.publicURL, path.basename(bundle.name))
          }
        });
      } else if (bundle.type === 'js') {
        bundles.push({
          tag: 'script',
          attrs: {
            src: urlJoin(this.options.publicURL, path.basename(bundle.name))
          }
        });
      }
    }

    this.addBundlesToTree(bundles, tree);
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

function findBundleInsertIndex(content) {
  for (let index = 0; index < content.length; index++) {
    const node = content[index];
    if (node && node.tag && !metadataContent.has(node.tag)) {
      return index;
    }
  }

  return 0;
}

module.exports = HTMLPackager;
