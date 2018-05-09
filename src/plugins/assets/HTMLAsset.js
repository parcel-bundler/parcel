const parse = require('posthtml-parser');
const api = require('posthtml/lib/api');
const urlJoin = require('../../utils/urlJoin');
const render = require('posthtml-render');
const posthtmlTransform = require('../../transforms/posthtml');
const htmlnanoTransform = require('../../transforms/htmlnano');
const isURL = require('../../utils/is-url');

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

const HTMLAsset = {
  type: 'html',

  init: () => ({
    isAstDirty: false
  }),

  parse(code) {
    let res = parse(code, {lowerCaseAttributeNames: true});
    res.walk = api.walk;
    res.match = api.match;
    return res;
  },

  collectDependencies(ast, state) {
    ast.walk(node => {
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
            let depHandler = getAttrDepHandler(attr);
            let options = OPTIONS[node.tag];
            node.attrs[attr] = depHandler(
              state,
              node.attrs[attr],
              options && options[attr]
            );
            state.isAstDirty = true;
          }
        }
      }

      return node;
    });
  },

  generate(ast, state) {
    return {
      html: state.isAstDirty ? render(ast) : state.contents
    };
  },

  pretransform(ast, state) {
    return posthtmlTransform(ast, state);
  },

  transform(ast, state) {
    if (state.options.minify) {
      return htmlnanoTransform(ast, state);
    }
  }
};

function processSingleDependency(asset, path, opts) {
  let assetPath = asset.addURLDependency(path, opts);
  if (!isURL(assetPath)) {
    assetPath = urlJoin(asset.options.publicURL, assetPath);
  }
  return assetPath;
}

function collectSrcSetDependencies(asset, srcset, opts) {
  const newSources = [];
  for (const source of srcset.split(',')) {
    const pair = source.trim().split(' ');
    if (pair.length === 0) continue;
    pair[0] = processSingleDependency(asset, pair[0], opts);
    newSources.push(pair.join(' '));
  }
  return newSources.join(',');
}

function getAttrDepHandler(attr) {
  if (attr === 'srcset') {
    return collectSrcSetDependencies;
  }
  return processSingleDependency;
}

module.exports = {
  Asset: {
    html: HTMLAsset,
    htm: HTMLAsset
  }
};
