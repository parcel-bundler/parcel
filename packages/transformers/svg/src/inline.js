// @flow

import type {AST, MutableAsset, TransformerResult} from '@parcel/types';
import {hashString} from '@parcel/hash';
import type {PostHTMLNode} from 'posthtml';

import PostHTML from 'posthtml';

export default function extractInlineAssets(
  asset: MutableAsset,
  ast: AST,
): Array<TransformerResult> {
  const program: PostHTMLNode = ast.program;
  let key = 0;

  // Extract <style> elements for processing.
  const parts: Array<TransformerResult> = [];
  PostHTML().walk.call(program, (node: PostHTMLNode) => {
    if (node.tag !== 'style') {
      return node;
    }

    const value = node.content && node.content.join('');

    let type;

    if (node.attrs && node.attrs.type != null) {
      type = node.attrs.type.split('/')[1];
    } else {
      type = 'css';
    }

    if (!type) {
      return node;
    }

    const parcelKey = hashString(`${asset.id}:${key++}`);

    if (!node.attrs) {
      node.attrs = {};
    }

    // Inform packager to remove type, since CSS is the default.
    delete node.attrs.type;

    // insert parcelId to allow us to retrieve node during packaging
    node.attrs['data-parcel-key'] = parcelKey;
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
      meta: {
        type: 'tag',
        // $FlowFixMe
        node,
        startLine: node.location?.start.line,
      },
    });

    return node;
  });

  return parts;
}
