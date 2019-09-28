// @flow strict-local

import {Transformer} from '@parcel/plugin';

type TypescriptCompilerOptions = {
  module?: mixed,
  jsx?: mixed,
  noEmit?: boolean,
  sourceMap?: boolean,
  ...
};

type TypescriptTranspilerOptions = {
  compilerOptions: TypescriptCompilerOptions,
  fileName: string,
  ...
};

export default new Transformer({
  async loadConfig({config}) {
    let configResult = await config.getConfig(['tsconfig.json']);

    config.setResult(configResult);
  },

  async transform({asset, config, options}) {
    asset.type = 'js';

    let [typescript, code] = await Promise.all([
      options.packageManager.require('typescript', asset.filePath),
      asset.getCode()
    ]);

    let transpiled = typescript.transpileModule(
      code,
      ({
        compilerOptions: {
          // React is the default. Users can override this by supplying their own tsconfig,
          // which many TypeScript users will already have for typechecking, etc.
          jsx: 'React',
          ...config?.compilerOptions,
          // Always emit output
          noEmit: false,
          // Don't compile ES `import`s -- scope hoisting prefers them and they will
          // otherwise compiled to CJS via babel in the js transformer
          module: typescript.ModuleKind.ESNext
        },
        fileName: asset.filePath // Should be relativePath?
      }: TypescriptTranspilerOptions)
    );

    return [
      {
        type: 'js',
        code: transpiled.outputText
      }
    ];
  }
});
