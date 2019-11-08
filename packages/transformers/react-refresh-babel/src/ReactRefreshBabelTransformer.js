// @flow

import semver from 'semver';
import invariant from 'assert';
import {Transformer} from '@parcel/plugin';
import {relativeUrl} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import {transformFromAst} from '@babel/core';
import generate from '@babel/generator';
import {parse} from '@babel/parser';

function shouldExclude(asset, options) {
  return !asset.env.isBrowser() || !options.hot || !asset.isSource;
}

export default new Transformer({
  async transform({asset, options}) {
    if (!shouldExclude(asset, options)) {
      let reactRefreshBabelPlugin = (await options.packageManager.resolve(
        'react-refresh/babel',
        __filename
      )).resolved;

      asset.meta.babelPlugins = asset.meta.babelPlugins || [];
      invariant(Array.isArray(asset.meta.babelPlugins));
      asset.meta.babelPlugins.push(reactRefreshBabelPlugin);
    }
    return [asset];
  }
});
