const Asset = require('../Asset');
const parse = require('posthtml-parser');
const api = require('posthtml/lib/api');
const urlJoin = require('../utils/urlJoin');
const render = require('posthtml-render');
const posthtmlTransform = require('../transforms/posthtml');
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
  href: ['link', 'a'],
  poster: ['video'],
  'xlink:href': ['use'],
  content: ['meta']
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

class HTMLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'html';
    this.isAstDirty = false;
  }

  parse(code) {
    let res = parse(code, {lowerCaseAttributeNames: true});
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

  collectInlineStyleDependencies(inlineStyle) {
    // split inline styles to rule array and filter the non-epmty ones
    const styles = inlineStyle
      .split(/;/)
      .filter(style => !/^[\n\s]*$/.test(style));

    styles.forEach((style, index) => {
      if (URL_RE.test(style)) {
        // match the url string, like "background: url('urlString')";
        let matchArr = /\(['"]?(.*?)['"]?\)/.exec(style);
        let path = matchArr.length > 1 ? matchArr[1] : null;
        // collect the dependencies and replace the origin path
        if (path) {
          let assetPath = this.processSingleDependency(path);
          styles[index] = style.replace(path, assetPath);
        }
      }
    });
    return styles.join(';');
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
          if (attr === 'style' && URL_RE.test(node.attrs[attr])) {
            node.attrs[attr] = this.collectInlineStyleDependencies(
              node.attrs[attr]
            );
            this.isAstDirty = true;
          }

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
