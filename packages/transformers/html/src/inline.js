// @flow strict-local

import type {MutableAsset, TransformerResult} from '@parcel/types';
import type {PostHTMLNode} from 'posthtml';

import PostHTML from 'posthtml';
import nullthrows from 'nullthrows';

const SCRIPT_TYPES = {
  'application/javascript': 'js',
  'text/javascript': 'js',
  'application/json': false,
  'application/ld+json': 'jsonld',
  'text/html': false
};

export default function extractInlineAssets(
  asset: TransformerInput
): Array<TransformerResult> {
  let ast = nullthrows(asset.ast);
  let program: PostHTMLNode = ast.program;

  // Extract inline <script> and <style> tags for processing.
  let parts = [];
  new PostHTML().walk.call(program, (node: PostHTMLNode) => {
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
          code: value,
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
        code: node.attrs.style,
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
