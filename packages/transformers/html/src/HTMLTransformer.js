// @flow

import {Transformer} from '@parcel/plugin';
import type {AST} from '@parcel/types';
import {parser as parse} from 'posthtml-parser';
import nullthrows from 'nullthrows';
import type {PostHTMLExpression, PostHTMLNode} from 'posthtml';
import PostHTML from 'posthtml';
import {render} from 'posthtml-render';
import semver from 'semver';
import collectDependencies from './dependencies';
import extractInlineAssets from './inline';
import ThrowableDiagnostic from '@parcel/diagnostic';

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse({asset}) {
    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), {
        lowerCaseTags: true,
        lowerCaseAttributeNames: true,
        sourceLocations: true,
        xmlMode: asset.type === 'xhtml',
      }),
    };
  },

  async transform({asset, options}) {
    if (asset.type === 'htm') {
      asset.type = 'html';
    }

    asset.bundleBehavior = 'isolated';
    let ast = nullthrows(await asset.getAST());
    let hasScripts;
    try {
      hasScripts = collectDependencies(asset, ast);
    } catch (errors) {
      throw new ThrowableDiagnostic({
        diagnostic: errors.map(error => ({
          message: error.message,
          origin: '@parcel/transformer-html',
          codeFrames: [
            {
              filePath: error.filePath,
              language: 'html',
              codeHighlights: [error.loc],
            },
          ],
        })),
      });
    }

    const {assets: inlineAssets, hasScripts: hasInlineScripts} =
      extractInlineAssets(asset, ast);

    const result = [asset, ...inlineAssets];

    // empty <script></script> is added to make sure HMR is working even if user
    // didn't add any.
    if (options.hmrOptions && !(hasScripts || hasInlineScripts)) {
      const script = {
        tag: 'script',
        attrs: {
          src: asset.addURLDependency('hmr.js', {
            priority: 'parallel',
          }),
        },
        content: [],
      };

      const found = findFirstMatch(ast, [{tag: 'body'}, {tag: 'html'}]);

      if (found) {
        found.content = found.content || [];
        found.content.push(script);
      } else {
        // Insert at the very end.
        ast.program.push(script);
      }

      asset.setAST(ast);

      result.push({
        type: 'js',
        content: '',
        uniqueKey: 'hmr.js',
      });
    }

    return result;
  },

  generate({ast, asset}) {
    return {
      content: render(ast.program, {
        closingSingleTag: asset.type === 'xhtml' ? 'slash' : undefined,
      }),
    };
  },
}): Transformer);

function findFirstMatch(
  ast: AST,
  expressions: PostHTMLExpression[],
): ?PostHTMLNode {
  let found;

  for (const expression of expressions) {
    PostHTML().match.call(ast.program, expression, node => {
      found = node;
      return node;
    });

    if (found) {
      return found;
    }
  }
}
