import {Validator} from '@parcel/plugin';
import localRequire from '@parcel/local-require';
import formatDiagnostics from './formatDiagnostics';
import LanguageServiceHost from './LanguageServiceHost';

export default new Validator({
  async getConfig({asset}) {
    return asset.getConfig(['tsconfig.json']);
  },

  async validate({asset, config, options}) {
    let ts = await localRequire('typescript', asset.filePath);

    let tsConfig = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      // This should be path of tsconfig
      options.projectRoot
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
