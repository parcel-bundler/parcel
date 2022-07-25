// @flow

import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import semver from 'semver';
import {parser as parse} from 'posthtml-parser';
import {render} from 'posthtml-render';
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
        directives: [
          {
            name: /^\?/,
            start: '<',
            end: '>',
          },
        ],
        sourceLocations: true,
        xmlMode: true,
      }),
    };
  },

  async transform({asset}) {
    asset.bundleBehavior = 'isolated';

    const ast = nullthrows(await asset.getAST());

    try {
      collectDependencies(asset, ast);
    } catch (errors) {
      throw new ThrowableDiagnostic({
        diagnostic: errors.map(error => ({
          message: error.message,
          origin: '@parcel/transformer-svg',
          codeFrames: [
            {
              filePath: error.filePath,
              language: 'svg',
              codeHighlights: [error.loc],
            },
          ],
        })),
      });
    }

    const inlineAssets = extractInlineAssets(asset, ast);

    return [asset, ...inlineAssets];
  },

  generate({ast}) {
    return {
      content: render(ast.program),
    };
  },
}): Transformer);
