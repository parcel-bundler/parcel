// @flow

import {Transformer} from '@parcel/plugin';
import semver from 'semver';
import parse from 'posthtml-parser';
import generate from 'posthtml-render';

// function addURLDependency(asset, url: string, opts) {
//   asset.addDependency({
//     moduleSpecifier: url,
//     isAsync: true,
//     ...opts
//   });
// }

export default new Transformer({
  canReuseAST(ast) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  parse(asset) {
    return {
      type: 'posthtml',
      version: '0.4.0',
      isDirty: false,
      program: parse(asset.code)
    };
  },

  transform(asset) {
    let ast = asset.ast;
    if (!ast) {
      return [asset];
    }

    return [asset];
  },

  generate(asset) {
    let code;
    if (!asset.ast || !asset.ast.isDirty) {
      code = asset.code;
    } else {
      code = generate(asset.ast);
    }

    return {
      code
    };
  }
});
