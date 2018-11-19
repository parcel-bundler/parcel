// @flow

import {Transformer} from '@parcel/plugin';
import parse from 'posthtml-parser';
import semver from 'semver';
import collectDependencies from './dependencies';
import extractInlineAssets from './inline';

export default new Transformer({
  canReuseAST(ast) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse(asset) {
    let ast = parse(await asset.getCode());
    return {
      type: 'posthtml',
      version: '0.4.0',
      program: ast
    };
  },

  async transform(asset) {
    collectDependencies(asset);
    return [asset, ...extractInlineAssets(asset)];
  }
});
