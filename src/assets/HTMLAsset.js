const Asset = require('../Asset');
const api = require('posthtml/lib/api');
const urlJoin = require('../utils/urlJoin');
const render = require('posthtml-render');
const posthtmlTransform = require('../transforms/posthtml');
const htmlnanoTransform = require('../transforms/htmlnano');
const isURL = require('../utils/is-url');

// A list of all attributes that may produce a dependency
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
  href: ['link', 'a', 'use'],
  srcset: ['img', 'source'],
  poster: ['video'],
  'xlink:href': ['use'],
  content: ['meta'],
  data: ['object']
};

// A list of metadata that should produce a dependency
// Based on:
// - http://schema.org/
// - http://ogp.me
// - https://developer.twitter.com/en/docs/tweets/optimize-with-cards/overview/markup
// - https://msdn.microsoft.com/en-us/library/dn255024.aspx
const META = {
  property: [
    'og:image',
    'og:image:url',
    'og:image:secure_url',
    'og:audio',
    'og:audio:secure_url',
    'og:video',
    'og:video:secure_url'
  ],
  name: [
    'twitter:image',
    'msapplication-square150x150logo',
    'msapplication-square310x310logo',
    'msapplication-square70x70logo',
    'msapplication-wide310x150logo',
    'msapplication-TileImage'
  ],
  itemprop: [
    'image',
    'logo',
    'screenshot',
    'thumbnailUrl',
    'contentUrl',
    'downloadUrl'
  ]
};

// Options to be passed to `addURLDependency` for certain tags + attributes
const OPTIONS = {
  a: {
    href: {entry: true}
  },
  iframe: {
    src: {entry: true}
  }
};

class HTMLAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'html';
    this.isAstDirty = false;
  }

  async parse(code) {
    let res = await posthtmlTransform.parse(code, this);
    res.walk = api.walk;
    res.match = api.match;
    return res;
  }

  processSingleDependency(path, opts) {
    let assetPath = this.addURLDependency(path, opts);
    if (!isURL(assetPath)) {
      assetPath = urlJoin(this.options.publicURL, assetPath);
    }
    return assetPath;
  }

  collectSrcSetDependencies(srcset, opts) {
    const newSources = [];
    for (const source of srcset.split(',')) {
      const pair = source.trim().split(' ');
      if (pair.length === 0) continue;
      pair[0] = this.processSingleDependency(pair[0], opts);
      newSources.push(pair.join(' '));
    }
    return newSources.join(',');
  }

  getAttrDepHandler(attr) {
    if (attr === 'srcset') {
      return this.collectSrcSetDependencies;
    }
    return this.processSingleDependency;
  }

  collectDependencies() {
    this.ast.walk(node => {
      if (node.attrs) {
        if (node.tag === 'meta') {
          if (
            !Object.keys(node.attrs).some(attr => {
              let values = META[attr];
              return values && values.includes(node.attrs[attr]);
            })
          ) {
            return node;
          }
        }

        for (let attr in node.attrs) {
          let elements = ATTRS[attr];
          // Check for virtual paths
          if (node.tag === 'a' && node.attrs[attr].lastIndexOf('.') < 1) {
            continue;
          }

          if (elements && elements.includes(node.tag)) {
            let depHandler = this.getAttrDepHandler(attr);
            let options = OPTIONS[node.tag];
            node.attrs[attr] = depHandler.call(
              this,
              node.attrs[attr],
              options && options[attr]
            );
            this.isAstDirty = true;
          }
        }
      }

      return node;
    });
  }

  async pretransform() {
    await posthtmlTransform.transform(this);
  }

  async transform() {
    if (this.options.minify) {
      await htmlnanoTransform(this);
    }
  }

  generate() {
    return this.isAstDirty ? render(this.ast) : this.contents;
  }
}

module.exports = HTMLAsset;
