// @flow
import {Transformer} from '@parcel/plugin';
import invariant from 'assert';
import path from 'path';

export default (new Transformer({
  async transform({asset, options}) {
    let code = await asset.getCode();
    if (code.includes('react-native-reanimated')) {
      asset.meta.babelPlugins ??= [];
      invariant(Array.isArray(asset.meta.babelPlugins));
      asset.meta.babelPlugins.push(
        path.posix.join(
          options.projectRoot,
          'node_modules/react-native-reanimated/plugin',
        ),
      );
    }
    return [asset];
  },
}): Transformer);
