// @flow
import path from 'path';
import {resolveConfig} from '@parcel/utils';
import {Validator} from '@parcel/plugin';
import localRequire from '@parcel/local-require';

import formatDiagnostics from './formatDiagnostics';
import LanguageServiceHost from './LanguageServiceHost';

export default new Validator({
  async validate({asset, options}) {
    let ts = await localRequire('typescript', asset.filePath);

    let configNames = ['tsconfig.json'];
    let configPath = await resolveConfig(asset.filePath, configNames);
    let config = {
      config: await asset.getConfig(configNames),
      baseDir: configPath ? path.dirname(configPath) : options.projectRoot
    };

    let tsConfig = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      config.baseDir
    );
    let host = new LanguageServiceHost(tsConfig, ts);
    let langService = ts.createLanguageService(
      host,
      ts.createDocumentRegistry()
    );

    const diagnostics = [
      ...langService.getSemanticDiagnostics(asset.filePath)
      // We probably don't need this as it'll throw on transform...
      // ...langService.getSyntacticDiagnostics(asset.filePath)
    ];

    if (diagnostics.length > 0) {
      const formatted = formatDiagnostics(diagnostics, asset.filePath);
      throw formatted;
    }
  }
});
