// @flow strict-local

import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import type {TranspileOptions} from 'typescript';

import {Transformer} from '@parcel/plugin';
import {loadTSConfig} from '@parcel/ts-utils';

export default (new Transformer({
  async loadConfig({config, options}) {
    await loadTSConfig(config, options);
  },

  async transform({asset, config, options}) {
    asset.type = 'js';

    let [typescript, code]: [TypeScriptModule, string] = await Promise.all([
      options.packageManager.require('typescript', asset.filePath, {
        shouldAutoInstall: options.shouldAutoInstall,
      }),
      asset.getCode(),
    ]);

    let transpiled = typescript.transpileModule(
      code,
      ({
        compilerOptions: {
          // React is the default. Users can override this by supplying their own tsconfig,
          // which many TypeScript users will already have for typechecking, etc.
          jsx: typescript.JsxEmit.React,
          ...config,
          // Always emit output
          noEmit: false,
          // Don't compile ES `import`s -- scope hoisting prefers them and they will
          // otherwise compiled to CJS via babel in the js transformer
          module: typescript.ModuleKind.ESNext,
        },
        fileName: asset.filePath, // Should be relativePath?
      }: TranspileOptions),
    );

    return [
      {
        type: 'js',
        content: transpiled.outputText,
      },
    ];
  },
}): Transformer);
