// @flow strict-local

import {Transformer} from '@parcel/plugin';
import path from 'path';
import SourceMap from '@parcel/source-map';

import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import type {CompilerOptions} from 'typescript';
import {CompilerHost, loadTSConfig} from '@parcel/ts-utils';
import {TSModuleGraph} from './TSModuleGraph';
import nullthrows from 'nullthrows';
import {collect} from './collect';
import {shake} from './shake';

export default new Transformer({
  async loadConfig({config, options}) {
    await loadTSConfig(config, options);
  },

  async transform({asset, config, options}) {
    let ts: TypeScriptModule = await options.packageManager.require(
      'typescript',
      asset.filePath
    );

    let opts: CompilerOptions = {
      ...config,
      // Always emit output
      noEmit: false,
      noEmitOnError: false,
      declaration: true,
      declarationMap: true,
      isolatedModules: false,
      emitDeclarationOnly: true,
      outFile: 'index.d.ts',
      moduleResolution: ts.ModuleResolutionKind.NodeJs
    };

    let host = new CompilerHost(options.inputFS, ts);
    // $FlowFixMe
    let program = ts.createProgram([asset.filePath], opts, host);

    let includedFiles = program
      .getSourceFiles()
      .filter(file => path.normalize(file.fileName) !== asset.filePath)
      .map(file => ({filePath: file.fileName}));

    let mainModuleName = path
      .relative(program.getCommonSourceDirectory(), asset.filePath)
      .slice(0, -path.extname(asset.filePath).length);
    let moduleGraph = new TSModuleGraph(ts, mainModuleName);

    program.emit(undefined, undefined, undefined, true, {
      afterDeclarations: [
        // 1. Build module graph
        context => sourceFile => {
          return collect(ts, moduleGraph, context, sourceFile);
        },
        // 2. Tree shake and rename types
        context => sourceFile => {
          return shake(ts, moduleGraph, context, sourceFile);
        }
      ]
    });

    let code = nullthrows(host.outputCode);
    code = code.substring(0, code.lastIndexOf('//# sourceMappingURL'));

    let map = JSON.parse(nullthrows(host.outputMap));
    map.sources = map.sources.map(source =>
      path.join(path.dirname(asset.filePath), source)
    );

    return [
      {
        type: 'ts',
        code,
        map: await SourceMap.fromRawSourceMap(map),
        includedFiles
      }
    ];
  }
});
