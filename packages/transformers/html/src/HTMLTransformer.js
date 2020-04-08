// @flow

import {Transformer} from '@parcel/plugin';
import parse from 'posthtml-parser';
import nullthrows from 'nullthrows';
import render from 'posthtml-render';
import semver from 'semver';
import collectDependencies from './dependencies';
import extractInlineAssets from './inline';

export default new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse({asset}) {
    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), {
        lowerCaseAttributeNames: true,
      }),
    };
  },

  async transform({asset}) {
    // Handle .htm
    asset.type = 'html';
    let ast = nullthrows(await asset.getAST());
    collectDependencies(asset, ast);
    return [asset, ...extractInlineAssets(asset, ast)];
  },

  generate({ast}) {
    return {
      content: render(ast.program),
    };
  },
});
