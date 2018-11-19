// @flow
import {Transformer} from '@parcel/plugin';
import parse from 'posthtml-parser';
import collectDependencies from './dependencies';
import extractInlineAssets from './inline';

export default new Transformer({
  canReuseAST(ast) {
    // TODO version
    return ast.type === 'posthtml';
  },

  async parse(asset) {
    let ast = parse(asset.code, {lowerCaseAttributeNames: true});
    return {
      type: 'posthtml',
      version: '...',
      program: ast
    };
  },

  async transform(asset) {
    collectDependencies(asset);
    return [asset, ...extractInlineAssets(asset)];
  }
});
