// @flow strict-local

import {babelErrorEnhancer} from '@parcel/babel-ast-utils';
import {Transformer} from '@parcel/plugin';
import {relativeUrl} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import semver from 'semver';
import generate from '@babel/generator';
import babel7 from './babel7';
import {load} from './config';

export default (new Transformer({
  async loadConfig({config, options, logger}) {
    await load(config, options, logger);
  },

  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async transform({asset, config, options}) {
    // TODO: Provide invalidateOnEnvChange on config?
    asset.invalidateOnEnvChange('BABEL_ENV');
    asset.invalidateOnEnvChange('NODE_ENV');

    // TODO: come up with a better name
    try {
      if (config?.config) {
        if (
          asset.meta.babelPlugins != null &&
          Array.isArray(asset.meta.babelPlugins)
        ) {
          await babel7(asset, options, config, asset.meta.babelPlugins);
        } else {
          await babel7(asset, options, config);
        }
      }

      return [asset];
    } catch (e) {
      throw await babelErrorEnhancer(e, asset);
    }
  },

  async generate({asset, ast, options}) {
    let originalSourceMap = await asset.getMap();
    let sourceFileName: string = relativeUrl(
      options.projectRoot,
      asset.filePath,
    );
    let {code, rawMappings} = generate(ast.program, {
      sourceFileName,
      sourceMaps: !!asset.env.sourceMap,
      comments: true,
    });

    let map = new SourceMap(options.projectRoot);
    if (rawMappings) {
      map.addIndexedMappings(rawMappings);
    }

    if (originalSourceMap) {
      map.extends(originalSourceMap.toBuffer());
    }

    return {
      content: code,
      map,
    };
  },
}): Transformer);
