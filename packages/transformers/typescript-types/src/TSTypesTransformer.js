// @flow strict-local

import {Transformer} from '@parcel/plugin';
import path from 'path';
import SourceMap from '@parcel/source-map';
import type {DiagnosticCodeFrame} from '@parcel/diagnostic';

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

  async transform({asset, config, options, logger}) {
    let ts: TypeScriptModule = await options.packageManager.require(
      'typescript',
      asset.filePath,
      {autoinstall: options.autoinstall},
    );

    let opts: CompilerOptions = {
      // React is the default. Users can override this by supplying their own tsconfig,
      // which many TypeScript users will already have for typechecking, etc.
      jsx: ts.JsxEmit.React,
      ...config,
      // Always emit output
      noEmit: false,
      noEmitOnError: false,
      declaration: true,
      declarationMap: true,
      isolatedModules: false,
      emitDeclarationOnly: true,
      outFile: 'index.d.ts',
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
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

    let emitResult = program.emit(undefined, undefined, undefined, true, {
      afterDeclarations: [
        // 1. Build module graph
        context => sourceFile => {
          return collect(ts, moduleGraph, context, sourceFile);
        },
        // 2. Tree shake and rename types
        context => sourceFile => {
          return shake(ts, moduleGraph, context, sourceFile);
        },
      ],
    });

    let diagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics);

    if (diagnostics.length > 0) {
      for (let diagnostic of diagnostics) {
        let filename = asset.filePath;
        let {file} = diagnostic;

        let diagnosticMessage =
          typeof diagnostic.messageText === 'string'
            ? diagnostic.messageText
            : diagnostic.messageText.messageText;

        let codeframe: ?DiagnosticCodeFrame;
        if (file != null && diagnostic.start != null) {
          let source = file.text || diagnostic.source;
          if (file.fileName) {
            filename = file.fileName;
          }

          // $FlowFixMe
          if (source) {
            let lineChar = file.getLineAndCharacterOfPosition(diagnostic.start);
            let start = {
              line: lineChar.line + 1,
              column: lineChar.character + 1,
            };
            let end = {
              line: start.line,
              column: start.column + 1,
            };

            if (typeof diagnostic.length === 'number') {
              let endCharPosition = file.getLineAndCharacterOfPosition(
                diagnostic.start + diagnostic.length,
              );

              end = {
                line: endCharPosition.line + 1,
                column: endCharPosition.character + 1,
              };
            }

            codeframe = {
              code: source,
              codeHighlights: {
                start,
                end,
                message: diagnosticMessage,
              },
            };
          }
        }

        logger.warn({
          message: diagnosticMessage,
          filePath: filename,
          codeFrame: codeframe ? codeframe : undefined,
        });
      }
    }

    let code = nullthrows(host.outputCode);
    code = code.substring(0, code.lastIndexOf('//# sourceMappingURL'));

    let map = JSON.parse(nullthrows(host.outputMap));
    map.sources = map.sources.map(source =>
      path.join(path.dirname(asset.filePath), source),
    );

    let sourceMap = null;
    if (map.mappings) {
      sourceMap = new SourceMap();
      sourceMap.addRawMappings(map);
    }

    return [
      {
        type: 'ts',
        content: code,
        map: sourceMap,
        includedFiles,
      },
    ];
  },
});
