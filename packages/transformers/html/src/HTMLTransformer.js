// @flow

import type {MutableAsset} from '@parcel/types';

import URL from 'url';
import nullthrows from 'nullthrows';
import {Transformer} from '@parcel/plugin';
import {isURL} from '@parcel/utils';
import semver from 'semver';
import parse from 'posthtml-parser';
import generate from 'posthtml-render';
import {walk} from 'posthtml/lib/api';

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

// eslint-disable-next-line
const SCRIPT_TYPES = {
  'application/javascript': 'js',
  'text/javascript': 'js',
  'application/json': false,
  'application/ld+json': 'jsonld',
  'text/html': false
};

export default new Transformer({
  canReuseAST(ast) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse(asset) {
    return {
      type: 'posthtml',
      version: '0.4.0',
      isDirty: false,
      program: parse(await asset.getCode())
    };
  },

  transform(asset) {
    let ast = nullthrows(asset.ast);

    walk.call(ast.program, node => {
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
          node.attrs.href = addURLDependency(asset, node.attrs.href, {
            isEntry: true
          });
          ast.isDirty = true;
          return node;
        }

        for (let attr in node.attrs) {
          let elements = ATTRS[attr];
          // Check for virtual paths
          if (node.tag === 'a' && node.attrs[attr].lastIndexOf('.') < 1) {
            continue;
          }

          if (elements && elements.includes(node.tag)) {
            let depHandler =
              attr === 'srccset' ? collectSrcSetDependencies : addURLDependency;
            node.attrs[attr] = depHandler(asset, node.attrs[attr], {
              isEntry: node.tag === 'a' || node.tag === 'iframe'
            });
            ast.isDirty = true;
          }
        }
      }

      return node;
    });

    return [asset];
  },

  async generate(asset: MutableAsset) {
    let ast = nullthrows(asset.ast);
    return {
      code: generate(ast.program)
    };
  }
  // Extract inline <script> and <style> tags for processing.
  // let parts = [];
  // this.ast.walk(node => {
  //   if (node.tag === 'script' || node.tag === 'style') {
  //     let value = node.content && node.content.join('').trim();
  //     if (value) {
  //       let type;
  //       if (node.tag === 'style') {
  //         if (node.attrs && node.attrs.type) {
  //           type = node.attrs.type.split('/')[1];
  //         } else {
  //           type = 'css';
  //         }
  //       } else if (node.attrs && node.attrs.type) {
  //         // Skip JSON
  //         if (SCRIPT_TYPES[node.attrs.type] === false) {
  //           return node;
  //         }
  //         if (SCRIPT_TYPES[node.attrs.type]) {
  //           type = SCRIPT_TYPES[node.attrs.type];
  //         } else {
  //           type = node.attrs.type.split('/')[1];
  //         }
  //       } else {
  //         type = 'js';
  //       }
  //       parts.push({
  //         type,
  //         value,
  //         inlineHTML: true,
  //         meta: {
  //           type: 'tag',
  //           node
  //         }
  //       });
  //     }
  //   }
  //   // Process inline style attributes.
  //   if (node.attrs && node.attrs.style) {
  //     parts.push({
  //       type: 'css',
  //       value: node.attrs.style,
  //       meta: {
  //         type: 'attr',
  //         node
  //       }
  //     });
  //   }
  //   return node;
  // });
  // return parts;
  // },

  // postProcess(assets: Array<Asset>) {
  //   let code;
  //   if (!asset.ast || !asset.ast.isDirty) {
  //     code = asset.code;
  //   } else {
  //     code = generate(asset.ast);
  //   }

  //   return {
  //     code
  //   };
  // }
});

function addURLDependency(asset, url: string, opts): string {
  if (isURL(url)) {
    return url;
  }

  let parsed = URL.parse(url);
  let moduleSpecifier = decodeURIComponent(nullthrows(parsed.pathname));
  parsed.pathname = asset.addDependency({
    moduleSpecifier,
    isURL: true,
    isAsync: true, // The browser has native loaders for url dependencies
    ...opts
  });
  return URL.format(parsed);
}

function collectSrcSetDependencies(asset, srcset, opts) {
  const newSources = [];
  for (const source of srcset.split(',')) {
    const pair = source.trim().split(' ');
    if (pair.length === 0) continue;
    pair[0] = addURLDependency(asset, pair[0], opts);
    newSources.push(pair.join(' '));
  }
  return newSources.join(',');
}
