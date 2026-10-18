import {Transformer} from '@parcel/plugin';
import * as babel from '@babel/core';

export default new Transformer<babel.TransformOptions | undefined>({
  async transform({asset, config, options}) {
    let babelOptions: babel.TransformOptions = {
      filename: asset.filePath,
      cwd: options.projectRoot,
      sourceMaps: !!asset.target.sourceMap,
      // @types/babel__core requires fields that are optional in the source map spec.
      inputSourceMap: (asset.getMap() ??
        undefined) as babel.TransformOptions['inputSourceMap'],
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
        return;
      }

      // Let Babel find babel.config.* and .babelrc files itself.
      let partialConfig = await babel.loadPartialConfigAsync(babelOptions);
      if (partialConfig == null || !partialConfig.hasFilesystemConfig()) {
        return;
      }
      babelOptions = partialConfig.options;
    }

    let code = asset.getCode();
    let result;
    try {
      result = await babel.transformAsync(code, babelOptions);
    } catch (err) {
      throw toDiagnosticError(err, asset.filePath);
    }

    // Babel returns null for files matched by an "ignore" option.
    if (result?.code == null) {
      return;
    }

    asset.setCode(result.code, result.map ?? null);
  },
});

// Reshape Babel errors so they are reported with a code frame at the error location.
function toDiagnosticError(err: any, filePath: string): unknown {
  if (err?.loc == null) {
    return err;
  }

  let message = String(err.message);
  if (message.startsWith(filePath + ': ')) {
    message = message.slice(filePath.length + 2);
  }

  let error = new Error(message.split('\n')[0].trim());
  Object.assign(error, {
    filename: filePath,
    line: err.loc.line,
    column: err.loc.column + 1,
  });
  return error;
}
