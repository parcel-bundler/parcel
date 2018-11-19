// @flow
import {Transformer} from '@parcel/plugin';
import generate from '@babel/generator';
import semver from 'semver';
import babel6 from './babel6';
import babel7 from './babel7';
import getBabelConfig from './config';

export default new Transformer({
  async getConfig(asset) {
    return {
      config: await getBabelConfig(asset),
      files: []
    };
  },

  canReuseAST(ast) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async transform(asset, config) {
    let ast;
    if (config[6]) {
      ast = await babel6(asset, config[6]);
    }

    if (config[7]) {
      ast = await babel7(asset, config[7]);
    }

    return [
      {
        type: 'js',
        ast: ast
          ? {
              type: 'babel',
              version: '7.0.0',
              program: ast
            }
          : null,
        code: asset.code
      }
    ];
  },

  generate(asset, config, options) {
    let opts = {
      sourceMaps: options.sourceMaps,
      sourceFileName: this.relativeName
    };

    let {code, map} = generate(asset.ast.program);

    return {
      code,
      map
    };
  }
});
