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
  poster: ['video'],
  'xlink:href': ['use']
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

  processSingleDependency(path) {
    let assetPath = this.addURLDependency(decodeURIComponent(path));
    if (!isURL(assetPath)) {
      assetPath = urlJoin(this.options.publicURL, assetPath);
    }
    return assetPath;
  }

  collectSrcSetDependencies(srcset) {
    const newSources = [];
    for (const source of srcset.split(',')) {
      const pair = source.trim().split(' ');
      if (pair.length === 0) continue;
      pair[0] = this.processSingleDependency(pair[0]);
      newSources.push(pair.join(' '));
    }
    return newSources.join(',');
  }

  collectDependencies() {
    this.ast.walk(node => {
      if (node.attrs) {
        for (let attr in node.attrs) {
          if (node.tag === 'img' && attr === 'srcset') {
            node.attrs[attr] = this.collectSrcSetDependencies(node.attrs[attr]);
            this.isAstDirty = true;
            continue;
          }
          let elements = ATTRS[attr];
          // Check for virtual paths
          if (node.tag === 'a' && node.attrs[attr].lastIndexOf('.') < 1) {
            continue;
          }
          if (elements && elements.includes(node.tag)) {
            node.attrs[attr] = this.processSingleDependency(node.attrs[attr]);
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
