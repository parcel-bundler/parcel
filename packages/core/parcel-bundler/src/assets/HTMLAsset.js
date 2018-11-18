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
  'xlink:href': ['use', 'image'],
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
    'msapplication-TileImage',
    'msapplication-config'
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

const SCRIPT_TYPES = {
  'application/javascript': 'js',
  'text/javascript': 'js',
  'application/json': false,
  'application/ld+json': 'jsonld',
  'text/html': false
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
    this.hmrPageReload = true;
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
    let {ast} = this;

    // Add bundled dependencies from plugins like posthtml-extend or posthtml-include, if any
    if (ast.messages) {
      ast.messages.forEach(message => {
        if (message.type === 'dependency') {
          this.addDependency(message.file, {
            includedInParent: true
          });
        }
      });
    }

    ast.walk(node => {
      if (node.attrs) {
        if (node.tag === 'meta') {
          if (
            !Object.keys(node.attrs).some(attr => {
              let values = META[attr];

              return (
                values &&
                values.includes(node.attrs[attr]) &&
                node.attrs.content !== ''
              );
            })
          ) {
            return node;
          }
        }

        if (
          node.tag === 'link' &&
          node.attrs.rel === 'manifest' &&
          node.attrs.href
        ) {
          node.attrs.href = this.getAttrDepHandler('href').call(
            this,
            node.attrs.href,
            {entry: true}
          );
          this.isAstDirty = true;
          return node;
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

  async generate() {
    // Extract inline <script> and <style> tags for processing.
    let parts = [];
    this.ast.walk(node => {
      if (node.tag === 'script' || node.tag === 'style') {
        let value = node.content && node.content.join('').trim();
        if (value) {
          let type;

          if (node.tag === 'style') {
            if (node.attrs && node.attrs.type) {
              type = node.attrs.type.split('/')[1];
            } else {
              type = 'css';
            }
          } else if (node.attrs && node.attrs.type) {
            // Skip JSON
            if (SCRIPT_TYPES[node.attrs.type] === false) {
              return node;
            }

            if (SCRIPT_TYPES[node.attrs.type]) {
              type = SCRIPT_TYPES[node.attrs.type];
            } else {
              type = node.attrs.type.split('/')[1];
            }
          } else {
            type = 'js';
          }

          parts.push({
            type,
            value,
            inlineHTML: true,
            meta: {
              type: 'tag',
              node
            }
          });
        }
      }

      // Process inline style attributes.
      if (node.attrs && node.attrs.style) {
        parts.push({
          type: 'css',
          value: node.attrs.style,
          meta: {
            type: 'attr',
            node
          }
        });
      }

      return node;
    });

    return parts;
  }

  async postProcess(generated) {
    // Replace inline scripts and styles with processed results.
    for (let rendition of generated) {
      let {type, node} = rendition.meta;
      if (type === 'attr' && rendition.type === 'css') {
        node.attrs.style = rendition.value;
      } else if (type === 'tag') {
        if (rendition.isMain) {
          node.content = rendition.value;
        }

        // Delete "type" attribute, since CSS and JS are the defaults.
        // Unless it's application/ld+json
        if (
          node.attrs &&
          (node.tag === 'style' ||
            (node.attrs.type && SCRIPT_TYPES[node.attrs.type] === 'js'))
        ) {
          delete node.attrs.type;
        }
      }
    }

    return [
      {
        type: 'html',
        value: render(this.ast)
      }
    ];
  }
}

module.exports = HTMLAsset;
