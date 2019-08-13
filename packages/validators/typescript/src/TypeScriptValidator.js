// @flow
import path from 'path';
import {md5FromObject} from '@parcel/utils';
import {Validator} from '@parcel/plugin';

import formatDiagnostics from './formatDiagnostics';
import LanguageServiceHost from './languageServiceHost';

let langServiceCache = {};

export default new Validator({
  async validate({asset, localRequire, options, resolveConfig}) {
    let ts = await localRequire('typescript', asset.filePath);

    let configNames = ['tsconfig.json'];
    let tsconfig = await asset.getConfig(configNames);
    let configPath = await resolveConfig(configNames);
    let baseDir = configPath ? path.dirname(configPath) : options.projectRoot;
    let configHash = (tsconfig ? md5FromObject(tsconfig) : '') + '-' + baseDir;

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
