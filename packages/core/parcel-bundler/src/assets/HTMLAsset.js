const Asset = require('../Asset');
const parse = require('posthtml-parser');
const api = require('posthtml/lib/api');
const urlJoin = require('../utils/urlJoin');
const render = require('posthtml-render');
const posthtmlTransform = require('../transforms/posthtml');
const isURL = require('../utils/is-url');

// A list of all attributes that should produce a dependency
// Based on https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes
const ATTRS = {
  src: [
    'script',
    'img',
    'audio',
    'video',
    'source',
    'track',
    'iframe',
    'embed'
  ],
  href: ['link', 'a'],
  poster: ['video']
};

class HTMLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'html';
    this.isAstDirty = false;
  }

  parse(code) {
    let res = parse(code);
    res.walk = api.walk;
    res.match = api.match;
    return res;
  }

  collectDependencies() {
    this.ast.walk(node => {
      if (node.attrs) {
        for (let attr in node.attrs) {
          let elements = ATTRS[attr];
          // Check for virtual paths
          if (node.tag === 'a' && node.attrs[attr].lastIndexOf('.') < 1) {
            continue;
          }
          if (elements && elements.includes(node.tag)) {
            let assetPath = this.addURLDependency(
              decodeURIComponent(node.attrs[attr])
            );
            if (!isURL(assetPath)) {
              assetPath = urlJoin(this.options.publicURL, assetPath);
            }
            node.attrs[attr] = assetPath;
            this.isAstDirty = true;
          }
        }
      }

      return node;
    });
  }

  async pretransform() {
    await posthtmlTransform(this);
  }

  generate() {
    let html = this.isAstDirty ? render(this.ast) : this.contents;
    return {html};
  }
}

module.exports = HTMLAsset;
