// @flow strict-local

import type {AST, MutableAsset, TransformerResult} from '@parcel/types';
import {md5FromString} from '@parcel/utils';
import type {PostHTMLNode} from 'posthtml';

import PostHTML from 'posthtml';

const SCRIPT_TYPES = {
  'application/javascript': 'js',
  'text/javascript': 'js',
  'application/json': false,
  'application/ld+json': 'jsonld',
  'text/html': false,
  module: 'js',
};

export default function extractInlineAssets(
  asset: MutableAsset,
  ast: AST,
): Array<TransformerResult> {
  let program: PostHTMLNode = ast.program;
  let key = 0;

  // Extract inline <script> and <style> tags for processing.
  let parts = [];
  new PostHTML().walk.call(program, (node: PostHTMLNode) => {
    let parcelKey = md5FromString(`${asset.id}:${key++}`);
    if (node.tag === 'script' || node.tag === 'style') {
      let value = node.content && node.content.join('');
      if (value != null) {
        let type, env;

        let context = new Set(asset.env.context);
        context.delete('module');
        context.delete('script');

        if (node.tag === 'style') {
          if (node.attrs && node.attrs.type) {
            type = node.attrs.type.split('/')[1];
          } else {
            type = 'css';
          }
        } else if (node.attrs && node.attrs.type != null) {
          // Skip JSON
          if (SCRIPT_TYPES[node.attrs.type] === false) {
            return node;
          }

          if (SCRIPT_TYPES[node.attrs.type]) {
            type = SCRIPT_TYPES[node.attrs.type];
          } else {
            type = node.attrs.type.split('/')[1];
          }

          let outputFormat = 'global';
          if (node.attrs.type === 'module') {
            if (
              asset.env.scopeHoist &&
              (asset.env.engines.browsers == null ||
                asset.env.supports('esmodules'))
            ) {
              outputFormat = 'esmodule';
            } else {
              delete node.attrs.type;
            }

            context.add('module');
          } else {
            context.add('script');
          }

          env = {
            context,
            outputFormat,
          };
        } else {
          type = 'js';
          context.add('script');
          env = {
            context,
          };
        }

        if (!node.attrs) {
          // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
          node.attrs = {};
        }

        // allow a script/style tag to declare its key
        if (node.attrs['data-parcel-key']) {
          parcelKey = node.attrs['data-parcel-key'];
        }

        // Inform packager to remove type, since CSS and JS are the defaults.
        if (node.attrs?.type && node.tag === 'style') {
          delete node.attrs.type;
        }

        // insert parcelId to allow us to retrieve node during packaging
        node.attrs['data-parcel-key'] = parcelKey;
        asset.setAST(ast); // mark dirty

        asset.addDependency({
          moduleSpecifier: parcelKey,
        });

        parts.push({
          type,
          content: value,
          uniqueKey: parcelKey,
          isInline: true,
          env,
          meta: {
            type: 'tag',
            node,
            loc: node.loc,
          },
        });
      }
    }

    // Process inline style attributes.
    let style = node.attrs?.style;
    if (style != null) {
      asset.addDependency({
        moduleSpecifier: parcelKey,
      });

      parts.push({
        type: 'css',
        content: style,
        uniqueKey: parcelKey,
        isInline: true,
        meta: {
          type: 'attr',
          node,
        },
      });
    }

    return node;
  });

  // $FlowFixMe
  return parts;
}
