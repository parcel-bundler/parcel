// @flow strict-local

import type {TranspileOptions} from 'typescript';

import {Transformer} from '@parcel/plugin';
import {loadTSConfig} from '@parcel/ts-utils';
import typescript from 'typescript';
import SourceMap from '@parcel/source-map';

export default (new Transformer({
  loadConfig({config, options}) {
    return loadTSConfig(config, options);
  },

  async transform({asset, config, options}) {
    let [code, originalMap] = await Promise.all([
      asset.getCode(),
      asset.getMap(),
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
          sourceMap: Boolean(asset.env.sourceMap),
          mapRoot: options.projectRoot,
        },
        fileName: asset.filePath, // Should be relativePath?
      }: TranspileOptions),
    );

    let {outputText, sourceMapText} = transpiled;

    if (sourceMapText != null) {
      outputText = outputText.substring(
        0,
        outputText.lastIndexOf('//# sourceMappingURL'),
      );

      let map = new SourceMap(options.projectRoot);
      map.addVLQMap(JSON.parse(sourceMapText));
      if (originalMap) {
        map.extends(originalMap);
      }
      asset.setMap(map);
    }

    asset.type = 'js';
    asset.setCode(outputText);

    return [asset];
  },
}): Transformer);
