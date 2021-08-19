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
  const stylesheets = [];
  PostHTML().walk.call(ast.program, node => {
    if (typeof node === 'string' && node.startsWith('<?xml-stylesheet')) {
      const [, href] = node.match(/(?<=(?:^|\s)href\s*=\s*")(.+?)(?=")/i) ?? [];

      if (!href) {
        return node;
      }
      stylesheets.push(href);

      return [];
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

  if (stylesheets.length) {
    PostHTML().match.call(ast.program, {tag: 'svg'}, node => {
      if (!node.content) {
        node.content = [];
      }

      const imports = stylesheets.map(href => `@import '${href}';`);

      // $FlowFixMe
      node.content.unshift({
        tag: 'style',
        content: imports,
      });
      isDirty = true;

      return node;
    });
  }

  if (isDirty) {
    asset.setAST(ast);
  }
}
