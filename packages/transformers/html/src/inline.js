// @flow strict-local

import type {MutableAsset, TransformerResult} from '@parcel/types';
import {md5FromString} from '@parcel/utils';
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
  asset: MutableAsset
): Array<TransformerResult> {
  let ast = nullthrows(asset.ast);
  let program: PostHTMLNode = ast.program;
  let key = 0;

  // Extract inline <script> and <style> tags for processing.
  let parts = [];
  new PostHTML().walk.call(program, (node: PostHTMLNode) => {
    let parcelKey = md5FromString(`${asset.id}:${key++}`);
    if (node.tag === 'script' || node.tag === 'style') {
      let value = node.content && node.content.join('').trim();
      if (value != null) {
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

        if (!node.attrs) {
          node.attrs = {};
        }

        // allow a script/style tag to declare its key
        if (node.attrs['data-parcel-key']) {
          parcelKey = node.attrs['data-parcel-key'];
        }

        // Inform packager to remove type, since CSS and JS are the defaults.
        // Unless it's application/ld+json
        if (
          node.attrs &&
          (node.tag === 'style' ||
            (node.attrs.type && SCRIPT_TYPES[node.attrs.type] === 'js'))
        ) {
          delete node.attrs.type;
        }

        // insert parcelId to allow us to retrieve node during packaging
        node.attrs['data-parcel-key'] = parcelKey;

        parts.push({
          type,
          code: value,
          uniqueKey: parcelKey,
          isIsolated: true,
          isInline: true,
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
        uniqueKey: parcelKey,
        isIsolated: true,
        isInline: true,
        meta: {
          type: 'attr',
          node
        }
      });
    }

    return node;
  });

  // $FlowFixMe
  return parts;
}
