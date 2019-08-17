// @flow
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import generate from '@babel/generator';
import semver from 'semver';
import babel6 from './babel6';
import babel7 from './babel7';
import getBabelConfig from './config';
import {relativeUrl} from '@parcel/utils';

export default new Transformer({
  async getConfig({asset}) {
    return getBabelConfig(asset);
  },

  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async transform({asset, config, localRequire}) {
    if (config) {
      if (config[6]) {
        asset.ast = await babel6(asset, localRequire, config[6]);
      }

      if (config[7]) {
        asset.ast = await babel7(asset, localRequire, config[7]);
      }
    }

    return [asset];
  },

  async generate({asset, options}) {
    let sourceFileName: string = relativeUrl(
      options.projectRoot,
      asset.filePath
    );

    // $FlowFixMe: figure out how to make AST required in generate method
    let generated = generate(asset.ast.program, {
      sourceMaps: options.sourceMaps,
      sourceFileName: sourceFileName
    });

    return {
      code: generated.code,
      map: new SourceMap(generated.rawMappings, {
        [sourceFileName]: null
      })
    };
  }
});
