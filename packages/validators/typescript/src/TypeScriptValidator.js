// @flow
import path from 'path';
import {md5FromObject} from '@parcel/utils';
import {Validator} from '@parcel/plugin';

import formatDiagnostics from './formatDiagnostics';
import LanguageServiceHost from './languageServiceHost';

let langServiceCache = {};

type TSValidatorConfig = {
  filepath: string | null,
  baseDir: string,
  configHash: string,
  tsconfig: any,
  ...
};

export default new Validator({
  async getConfig({
    asset,
    options,
    resolveConfig
  }): Promise<?TSValidatorConfig> {
    let configNames = ['tsconfig.json'];
    let tsconfig = await asset.getConfig(configNames);
    let configPath: string | null = await resolveConfig(configNames);
    let baseDir = configPath ? path.dirname(configPath) : options.projectRoot;
    let configHash = (tsconfig ? md5FromObject(tsconfig) : '') + '-' + baseDir;

    return {
      filepath: configPath,
      baseDir,
      configHash,
      tsconfig
    };
  },

  async validate({asset, config, options}) {
    let ts = await options.packageManager.require('typescript', asset.filePath);

    // This should never happen...
    if (!config) return;

    let {baseDir, configHash, tsconfig} = config;
    if (tsconfig && !langServiceCache[configHash]) {
      let parsedCommandLine = ts.parseJsonConfigFileContent(
        tsconfig,
        ts.sys,
        baseDir
      );

      langServiceCache[configHash] = ts.createLanguageService(
        new LanguageServiceHost(parsedCommandLine, ts, baseDir),
        ts.createDocumentRegistry()
      );
    }

    if (!langServiceCache[configHash]) return;

    const diagnostics = langServiceCache[configHash].getSemanticDiagnostics(
      asset.filePath
    );

    if (diagnostics.length > 0) {
      const formatted = formatDiagnostics(
        diagnostics,
        asset.filePath,
        asset.fs.cwd()
      );
      throw formatted;
    }
  }
});
