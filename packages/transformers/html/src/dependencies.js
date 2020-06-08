// @flow

import type {AST, Environment, MutableAsset} from '@parcel/types';
import PostHTML from 'posthtml';

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
    'embed',
  ],
  // Using href with <script> is described here: https://developer.mozilla.org/en-US/docs/Web/SVG/Element/script
  href: ['link', 'a', 'use', 'script'],
  srcset: ['img', 'source'],
  poster: ['video'],
  'xlink:href': ['use', 'image', 'script'],
  content: ['meta'],
  data: ['object'],
};

// A list of metadata that should produce a dependency
// Based on:
// - http://schema.org/
// - http://ogp.me
// - https://developer.twitter.com/en/docs/tweets/optimize-with-cards/overview/markup
// - https://msdn.microsoft.com/en-us/library/dn255024.aspx
// - https://vk.com/dev/publications
const META = {
  property: [
    'og:image',
    'og:image:url',
    'og:image:secure_url',
    'og:audio',
    'og:audio:secure_url',
    'og:video',
    'og:video:secure_url',
    'vk:image',
  ],
  name: [
    'twitter:image',
    'msapplication-square150x150logo',
    'msapplication-square310x310logo',
    'msapplication-square70x70logo',
    'msapplication-wide310x150logo',
    'msapplication-TileImage',
    'msapplication-config',
  ],
  itemprop: [
    'image',
    'logo',
    'screenshot',
    'thumbnailUrl',
    'contentUrl',
    'downloadUrl',
  ],
};

// Options to be passed to `addURLDependency` for certain tags + attributes
const OPTIONS = {
  a: {
    href: {isEntry: true},
  },
  iframe: {
    src: {isEntry: true},
  },
  script(attrs, env: Environment) {
    return {
      env: {
        outputFormat:
          attrs.type === 'module' && env.scopeHoist ? 'esmodule' : undefined,
      },
    };
  },
};

function collectSrcSetDependencies(asset, srcset, opts) {
  let newSources = [];
  for (const source of srcset.split(',')) {
    let pair = source.trim().split(' ');
    if (pair.length === 0) {
      continue;
    }

    pair[0] = asset.addURLDependency(pair[0], opts);
    newSources.push(pair.join(' '));
  }

  return newSources.join(',');
}

function getAttrDepHandler(attr) {
  if (attr === 'srcset') {
    return collectSrcSetDependencies;
  }

  return (asset, src, opts) => asset.addURLDependency(src, opts);
}

export default function collectDependencies(asset: MutableAsset, ast: AST) {
  let isDirty = false;
  PostHTML().walk.call(ast.program, node => {
    let {tag, attrs} = node;
    if (!attrs) {
      return node;
    }

    if (tag === 'meta') {
      if (
        !Object.keys(attrs).some(attr => {
          let values = META[attr];
          return (
            values &&
            values.includes(attrs[attr]) &&
            attrs.content !== '' &&
            !(attrs.name === 'msapplication-config' && attrs.content === 'none')
          );
        })
      ) {
        return node;
      }
    }

    if (
      tag === 'link' &&
      (attrs.rel === 'canonical' || attrs.rel === 'manifest') &&
      attrs.href
    ) {
      attrs.href = asset.addURLDependency(attrs.href, {
        isEntry: true,
      });
      isDirty = true;
      return node;
    }

    for (let attr in attrs) {
      // Check for virtual paths
      if (tag === 'a' && attrs[attr].lastIndexOf('.') < 1) {
        continue;
      }

      let elements = ATTRS[attr];
      if (elements && elements.includes(node.tag)) {
        let depHandler = getAttrDepHandler(attr);
        let depOptionsHandler = OPTIONS[node.tag];
        let depOptions =
          typeof depOptionsHandler === 'function'
            ? depOptionsHandler(attrs, asset.env)
            : depOptionsHandler && depOptionsHandler[attr];
        attrs[attr] = depHandler(asset, attrs[attr], depOptions);
        isDirty = true;
      }
    }

    if (isDirty) {
      asset.setAST(ast);
    }

    return node;
  });
}
