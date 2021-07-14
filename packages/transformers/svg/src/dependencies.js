// @flow

import type {AST, MutableAsset} from '@parcel/types';

// A list of all attributes that may produce a dependency
// Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
const ATTRS = {
  null: {
    href: ['a', 'use'],
  },
  'http://www.w3.org/1999/xlink': {
    href: ['a', 'use'],
  },
};

// Options to be passed to `addDependency` for certain tags + attributes
const OPTIONS = {
  a: {
    null: {
      href: {needsStableName: true},
    },
    'http://www.w3.org/1999/xlink': {
      href: {needsStableName: true},
    },
  },
};

export default function collectDependencies(asset: MutableAsset, ast: AST) {
  const {document, Node, NodeFilter} = ast.program.window;
  let isDirty = false;

  const walker = document.createTreeWalker(
    document,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION,
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (
      node.nodeType === Node.PROCESSING_INSTRUCTION_NODE &&
      node.target === 'xml-stylesheet'
    ) {
      node.data = node.data.replace(
        /(?<=(?:^|\s)href\s*=\s*")(.+?)(?=")/i,
        href => {
          isDirty = true;

          return asset.addURLDependency(href, {priority: 'parallel'});
        },
      );
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const {attributes} = node;
      for (let i = attributes.length - 1; i >= 0; i--) {
        const attr = attributes[i];
        const elements = ATTRS[attr.namespaceURI]?.[attr.localName];
        if (
          elements &&
          elements.includes(node.localName) &&
          !attr.value.startsWith('#')
        ) {
          isDirty = true;

          const depOptions =
            OPTIONS[node.localName]?.[attr.namespaceURI][attr.localName];
          attr.value = asset.addURLDependency(attr.value, depOptions);
        }
      }
    }
  }

  if (isDirty) {
    asset.setAST(ast);
  }
}
