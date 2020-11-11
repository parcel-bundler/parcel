// @flow strict-local

import {generate, babelErrorEnhancer} from '@parcel/babel-ast-utils';
import {Transformer} from '@parcel/plugin';
import semver from 'semver';
import babel7 from './babel7';
import {load, preSerialize, postDeserialize} from './config';

export default (new Transformer({
  async loadConfig({config, options, logger}) {
    await load(config, options, logger);
  },

  preSerializeConfig({config}) {
    return preSerialize(config);
  },

  postDeserializeConfig({config, options}) {
    return postDeserialize(config, options);
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

  generate({asset, ast, options}) {
    return generate({asset, ast, options});
  },
}): Transformer);
