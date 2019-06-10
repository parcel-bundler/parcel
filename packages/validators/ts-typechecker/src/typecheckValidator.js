// @flow
import path from 'path';
import findUp from 'find-up';
import {Validator} from '@parcel/plugin';
import localRequire from '@parcel/local-require';

import formatDiagnostics from './formatDiagnostics';
import LanguageServiceHost from './LanguageServiceHost';

async function findUpDir(fileName, cwd) {
  let foundFile = await findUp(fileName, {cwd});

  if (foundFile) {
    return path.dirname(foundFile);
  }
}

export default new Validator({
  async validate({asset, options}) {
    let ts = await localRequire('typescript', asset.filePath);
    let config = {
      config: await asset.getConfig(['tsconfig.json']),
      baseDir:
        (await findUpDir('tsconfig.json', path.dirname(asset.filePath))) ||
        options.projectRoot
    };

    let tsConfig = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(config.baseDir)
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
