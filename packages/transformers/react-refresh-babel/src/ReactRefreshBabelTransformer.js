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
  return (
    !asset.env.isBrowser() ||
    !options.hot ||
    !asset.isSource ||
    asset.filePath.includes('packages/runtimes')
  );
}

export default new Transformer({
  async transform({asset, options}) {
    asset.type = 'js';
    if (!shouldExclude(asset, options)) {
      let reactRefreshBabelPlugin = (await options.packageManager.resolve(
        'react-refresh/babel',
        __filename
      )).resolved;

      asset.meta.babelTransforms = asset.meta.babelTransforms || [];
      invariant(Array.isArray(asset.meta.babelTransforms));
      asset.meta.babelTransforms.push(reactRefreshBabelPlugin);
    }
    return [asset];
  }
});
