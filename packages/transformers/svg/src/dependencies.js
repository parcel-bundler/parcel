// @flow

import type {AST, MutableAsset} from '@parcel/types';
import PostHTML from 'posthtml';

// A list of all attributes that may produce a dependency
// Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
const ATTRS = {
  href: ['a', 'use'],
  'xlink:href': ['a', 'use'],
};

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
        attrs[attr] = asset.addURLDependency(attrs[attr], OPTIONS[tag]?.[attr]);
        isDirty = true;
      }
    }

    return node;
  });

  if (isDirty) {
    asset.setAST(ast);
  }
}
