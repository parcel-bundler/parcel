// @flow
import path from 'path';
import {resolveConfig} from '@parcel/utils';
import {Validator} from '@parcel/plugin';
import localRequire from '@parcel/local-require';

import formatDiagnostics from './formatDiagnostics';
import LanguageServiceHost from './LanguageServiceHost';

let langServiceCache = {};

export default new Validator({
  async validate({asset, options}) {
    let ts = await localRequire('typescript', asset.filePath);

    let configNames = ['tsconfig.json'];
    // $FlowFixMe
    let configPath = await resolveConfig(asset.filePath, configNames);

    if (!langServiceCache[configPath]) {
      let tsconfig = (await asset.getConfig(configNames)) || {};
      let baseDir = configPath ? path.dirname(configPath) : options.projectRoot;
      let parsedCommandLine = ts.parseJsonConfigFileContent(
        tsconfig,
        ts.sys,
        baseDir
      );

      langServiceCache[configPath] = ts.createLanguageService(
        new LanguageServiceHost(parsedCommandLine, ts, baseDir),
        ts.createDocumentRegistry()
      );
    }

    const diagnostics = langServiceCache[configPath].getSemanticDiagnostics(
      asset.filePath
    );
    if (diagnostics.length > 0) {
      const formatted = formatDiagnostics(diagnostics, asset.filePath);
      throw formatted;
    }
  }
});
