// @flow

import {Transformer} from '@parcel/plugin';
import * as babel from '@babel/core';

export default (new Transformer({
  async transform({asset, config, options}) {
    let babelOptions = {
      filename: asset.filePath,
      cwd: options.projectRoot,
      sourceMaps: !!asset.target.sourceMap,
      inputSourceMap: asset.getMap() ?? undefined,
      // Parcel handles modules itself, so presets should leave them alone.
      caller: {
        name: 'parcel',
        supportsStaticESM: true,
        supportsDynamicImport: true,
        supportsTopLevelAwait: true,
        supportsExportNamespaceFrom: true,
      },
    };

    if (config != null) {
      // Config from .parcelrc is used exactly as given.
      babelOptions = {
        ...config,
        ...babelOptions,
        babelrc: false,
        configFile: false,
      };
    } else {
      if (!asset.isSource) {
        return [asset];
      }

      // Let Babel find babel.config.* and .babelrc files itself.
      let partialConfig = await babel.loadPartialConfigAsync(babelOptions);
      if (partialConfig == null || !partialConfig.hasFilesystemConfig()) {
        return [asset];
      }
      babelOptions = partialConfig.options;
    }

    let code = await asset.getCode();
    let result;
    try {
      result = await babel.transformAsync(code, babelOptions);
    } catch (err) {
      throw toDiagnosticError(err, asset.filePath);
    }

    // Babel returns null for files matched by an "ignore" option.
    if (result == null) {
      return [asset];
    }

    asset.setCode(result.code, result.map ?? null);
    return [asset];
  },
}): Transformer);

// Reshape Babel errors so they are reported with a code frame at the error location.
function toDiagnosticError(err, filePath) {
  if (err?.loc == null) {
    return err;
  }

  let message = String(err.message);
  if (message.startsWith(filePath + ': ')) {
    message = message.slice(filePath.length + 2);
  }

  let error = new Error(message.split('\n')[0].trim());
  // $FlowFixMe
  Object.assign(error, {
    filename: filePath,
    line: err.loc.line,
    column: err.loc.column + 1,
  });
  return error;
}
