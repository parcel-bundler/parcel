// @flow
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
import generate from '@babel/generator';
import semver from 'semver';
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

  async transform({asset, config}) {
    if (config) {
      asset.ast = await babel7(asset, config);
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
