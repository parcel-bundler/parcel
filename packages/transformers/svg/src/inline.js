// @flow

import type {AST, MutableAsset, TransformerResult} from '@parcel/types';
import {hashString} from '@parcel/hash';
import type {PostHTMLNode} from 'posthtml';

import PostHTML from 'posthtml';

const SCRIPT_TYPES = {
  'application/ecmascript': 'js',
  'application/javascript': 'js',
  'text/javascript': 'js',
  module: 'js',
};

export default function extractInlineAssets(
  asset: MutableAsset,
  ast: AST,
): Array<TransformerResult> {
  const program: PostHTMLNode = ast.program;
  let key = 0;

  // Extract <style> elements for processing.
  const parts: Array<TransformerResult> = [];
  PostHTML().walk.call(program, (node: PostHTMLNode) => {
    if (node.tag === 'style' || node.tag === 'script') {
      const value = node.content && node.content.join('');
      if (!value) {
        return node;
      }

      let type, env;
      if (node.tag === 'style') {
        if (node.attrs && node.attrs.type != null) {
          type = node.attrs.type.split('/')[1];
        } else {
          type = 'css';
        }
      } else if (node.tag === 'script') {
        if (node.attrs && SCRIPT_TYPES[node.attrs.type]) {
          type = SCRIPT_TYPES[node.attrs.type];
        } else if (node.attrs) {
          type = node.attrs.type.split('/')[1];
        } else {
          type = 'js';
        }

        env = {
          sourceType:
            node.attrs && node.attrs.type === 'module' ? 'module' : 'script',
          // SVG script elements do not support type="module" natively yet.
          outputFormat: 'global',
          loc: node.location
            ? {
                filePath: asset.filePath,
                start: node.location.start,
                end: node.location.end,
              }
            : undefined,
        };
      }

      if (!type) {
        return node;
      }

      let attrs = node.attrs;
      if (!attrs) {
        attrs = {};
        node.attrs = attrs;
      }

      // Inform packager to remove type, since CSS and JS are the defaults.
      delete attrs.type;

      let parcelKey;
      // allow a script/style tag to declare its key
      if (attrs['data-parcel-key']) {
        parcelKey = attrs['data-parcel-key'];
      } else {
        parcelKey = hashString(`${asset.id}:${key++}`);
      }

      // insert parcelId to allow us to retrieve node during packaging
      attrs['data-parcel-key'] = parcelKey;
      asset.setAST(ast); // mark dirty

      asset.addDependency({
        specifier: parcelKey,
        specifierType: 'esm',
      });

      parts.push({
        type,
        content: value,
        uniqueKey: parcelKey,
        bundleBehavior: 'inline',
        env,
        meta: {
          type: 'tag',
          // $FlowFixMe
          node,
          startLine: node.location?.start.line,
        },
      });
    }

    // Process inline style attributes.
    let attrs = node.attrs;
    let style = attrs?.style;
    if (attrs != null && style != null) {
      let parcelKey = hashString(`${asset.id}:${key++}`);
      attrs.style = asset.addDependency({
        specifier: parcelKey,
        specifierType: 'esm',
      });
      asset.setAST(ast); // mark dirty

      parts.push({
        type: 'css',
        content: style,
        uniqueKey: parcelKey,
        bundleBehavior: 'inline',
        meta: {
          type: 'attr',
          // $FlowFixMe
          node,
        },
      });
    }

    return node;
  });

  return parts;
}
