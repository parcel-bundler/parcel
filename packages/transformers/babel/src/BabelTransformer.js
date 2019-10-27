// @flow strict-local

import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';
// $FlowFixMe
import generate from '@babel/generator';
import semver from 'semver';
import babel7 from './babel7';
import {relativeUrl} from '@parcel/utils';
import {load, rehydrate} from './config';

export default new Transformer({
  async loadConfig({config, options}) {
    await load(config, options);
  },

  rehydrateConfig({config, options}) {
    return rehydrate(config, options);
  },

  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async transform({asset, ast, config, options}) {
    // TODO: come up with a better name
    if (config?.config) {
      await babel7(asset, ast, options, config);
    }

    return [asset];
  },

  generate({asset, ast, options}) {
    let sourceFileName: string = relativeUrl(
      options.projectRoot,
      asset.filePath
    );

    let generated = generate(ast.program, {
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
