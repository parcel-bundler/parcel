// @flow strict-local

import type {AST, MutableAsset, TransformerResult} from '@atlaspack/types';
import {hashString} from '@atlaspack/rust';
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

interface ExtractInlineAssetsResult {
  hasModuleScripts: boolean;
  assets: Array<TransformerResult>;
}

export default function extractInlineAssets(
  asset: MutableAsset,
  ast: AST,
): ExtractInlineAssetsResult {
  let program: PostHTMLNode = ast.program;
  let key = 0;

  // Extract inline <script> and <style> tags for processing.
  let parts: Array<TransformerResult> = [];
  let hasModuleScripts = false;
  PostHTML().walk.call(program, (node: PostHTMLNode) => {
    let atlaspackKey = hashString(`${asset.id}:${key++}`);
    if (node.tag === 'script' || node.tag === 'style') {
      let value = node.content && node.content.join('');
      if (value != null) {
        let type, env;

        if (node.tag === 'style') {
          if (node.attrs && node.attrs.type != null) {
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
          let sourceType = 'script';
          let attrs = node.attrs;
          if (attrs && attrs.type === 'module') {
            if (
              asset.env.shouldScopeHoist &&
              asset.env.supports('esmodules', true)
            ) {
              outputFormat = 'esmodule';
            } else {
              delete attrs.type;
            }

            sourceType = 'module';
          }

          let loc = node.location
            ? {
                filePath: asset.filePath,
                start: node.location.start,
                end: node.location.end,
              }
            : undefined;

          env = {
            sourceType,
            outputFormat,
            loc,
          };
        } else {
          let loc = node.location
            ? {
                filePath: asset.filePath,
                start: node.location.start,
                end: node.location.end,
              }
            : undefined;
          type = 'js';
          env = {
            sourceType: 'script',
            loc,
          };
        }

        if (!type) {
          return node;
        }

        if (!node.attrs) {
          node.attrs = {};
        }

        // allow a script/style tag to declare its key
        if (node.attrs['data-atlaspack-key']) {
          atlaspackKey = node.attrs['data-atlaspack-key'];
        }

        // Inform packager to remove type, since CSS and JS are the defaults.
        if (node.attrs?.type && node.tag === 'style') {
          delete node.attrs.type;
        }

        // insert atlaspackId to allow us to retrieve node during packaging
        node.attrs['data-atlaspack-key'] = atlaspackKey;
        asset.setAST(ast); // mark dirty

        asset.addDependency({
          specifier: atlaspackKey,
          specifierType: 'esm',
        });

        parts.push({
          type,
          content: value,
          uniqueKey: atlaspackKey,
          bundleBehavior: 'inline',
          env,
          meta: {
            type: 'tag',
            // $FlowFixMe
            node,
            startLine: node.location?.start.line,
          },
        });

        if (env && env.sourceType === 'module') {
          hasModuleScripts = true;
        }
      }
    }

    // Process inline style attributes.
    let attrs = node.attrs;
    let style = attrs?.style;
    if (attrs != null && style != null) {
      attrs.style = asset.addDependency({
        specifier: atlaspackKey,
        specifierType: 'esm',
      });
      asset.setAST(ast); // mark dirty

      parts.push({
        type: 'css',
        content: style,
        uniqueKey: atlaspackKey,
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

  return {
    assets: parts,
    hasModuleScripts,
  };
}
