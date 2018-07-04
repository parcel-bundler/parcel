const Asset = require('../Asset');
const api = require('posthtml/lib/api');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
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
const URL_RE = /url\s*\("?(?![a-z]+:)/;

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

  collectInlineStyleDependencies(inlineStyle) {
    const ast = postcss.parse(inlineStyle);
    let isAstDirty = false;

    ast.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let dirty = false;

        parsed.walk(node => {
          if (
            node.type === 'function' &&
            node.value === 'url' &&
            node.nodes.length
          ) {
            let url = this.processSingleDependency(node.nodes[0].value);
            dirty = node.nodes[0].value !== url;
            node.nodes[0].value = url;
          }
        });

        if (dirty) {
          isAstDirty = true;
          decl.value = parsed.toString();
        }
      }
    });

    if (isAstDirty) {
      let css = '';
      postcss.stringify(ast, c => (css += c));
      return css;
    } else {
      return null;
    }
  }

  getAttrDepHandler(attr) {
    if (attr === 'srcset') {
      return this.collectSrcSetDependencies;
    }
    if (attr === 'style') {
      return this.collectInlineStyleDependencies;
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

          // since every element might produce style dependecies
          if (attr === 'style' && URL_RE.test(node.attrs[attr])) {
            let depHandler = this.getAttrDepHandler(attr);
            let dirtyInlineStyle = depHandler.call(this, node.attrs[attr]);
            if (dirtyInlineStyle) {
              node.attrs[attr] = dirtyInlineStyle;
              this.isAstDirty = true;
            }
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
