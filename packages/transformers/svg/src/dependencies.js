// @flow

import type {AST, MutableAsset} from '@parcel/types';
import PostHTML from 'posthtml';

// A list of all attributes that may produce a dependency
// Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
// See also https://www.w3.org/TR/SVG/attindex.html and https://www.w3.org/TR/SVG11/attindex.html
// SVG animation elements are excluded because they may only reference elements in the same document: https://www.w3.org/TR/SVG/linking.html#processingURL-fetch
const HREF_ATTRS = [
  'a',
  'use',
  'feImage',
  'image',
  'linearGradient',
  'radialGradient',
  'pattern',
  'mpath',
  'textPath',
  'script',
];
const ATTRS = {
  href: HREF_ATTRS,
  'xlink:href': [
    ...HREF_ATTRS,
    'altGlyph',
    'cursor',
    'filter',
    'font-face-uri',
    'glyphRef',
    'tref',
    'color-profile',
  ],
};

// Attributes that allow url() to reference another element, either in the same document or a different one.
// https://www.w3.org/TR/SVG11/linking.html#processingIRI
const FUNC_IRI_ATTRS = new Set([
  'fill',
  'stroke',
  'clip-path',
  'color-profile',
  'cursor',
  'filter',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'mask',

  // SVG2 - https://www.w3.org/TR/SVG/linking.html#processingURL-validity
  'shape-inside',
  'shape-subtract',
  'mask-image',
]);

// https://www.w3.org/TR/css3-values/#urls
const FUNC_IRI_RE =
  /^url\((?:((['"])(.*?)\2(\s+.*)?)|((?:\\[\s'"]|[^\s'"])+))\)$/;
const ESCAPE_RE = /\\(.|\n|\r|\u2028|\u2029)/;
export function parseFuncIRI(value: string): ?[string, string] {
  let m = value.match(FUNC_IRI_RE);
  if (m) {
    let url = (m[3] || m[5]).replace(ESCAPE_RE, '$1');
    let modifier = m[4] ?? '';
    return [url, modifier];
  }
}

// Options to be passed to `addDependency` for certain tags + attributes
const OPTIONS = {
  a: {
    href: {needsStableName: true},
    'xlink:href': {needsStableName: true},
  },
};

export default function collectDependencies(asset: MutableAsset, ast: AST) {
  let isDirty = false;
  PostHTML().walk.call(ast.program, node => {
    // Ideally we'd have location information for specific attributes...
    let getLoc = () =>
      node.location
        ? {
            filePath: asset.filePath,
            start: node.location.start,
            end: node.location.end,
          }
        : undefined;
    if (typeof node === 'string' && node.startsWith('<?xml-stylesheet')) {
      return node.replace(/(?<=(?:^|\s)href\s*=\s*")(.+?)(?=")/i, href => {
        isDirty = true;

        return asset.addURLDependency(href, {priority: 'parallel'});
      });
    }

    const {tag, attrs} = node;
    if (!attrs) {
      return node;
    }

    for (const attr in attrs) {
      // Check for id references
      if (attrs[attr][0] === '#') {
        continue;
      }

      const elements = ATTRS[attr];
      if (elements && elements.includes(node.tag)) {
        let options = OPTIONS[tag]?.[attr];
        if (node.tag === 'script') {
          options = {
            priority: 'parallel',
            env: {
              sourceType: attrs.type === 'module' ? 'module' : 'script',
              // SVG script elements do not support type="module" natively yet.
              outputFormat: 'global',
              loc: getLoc(),
            },
          };
          delete attrs.type;
        }
        attrs[attr] = asset.addURLDependency(attrs[attr], {
          ...options,
          loc: getLoc(),
        });
        isDirty = true;
      }

      if (FUNC_IRI_ATTRS.has(attr)) {
        let parsed = parseFuncIRI(attrs[attr]);
        if (parsed) {
          let depId = asset.addURLDependency(parsed[0], {
            loc: getLoc(),
          });
          attrs[attr] = `url('${depId}'${parsed[1]})`;
          isDirty = true;
        }
      }
    }

    return node;
  });

  if (isDirty) {
    asset.setAST(ast);
  }
}
