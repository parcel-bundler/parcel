// @flow strict-local

import {Transformer} from '@parcel/plugin';
import path from 'path';
import SourceMap from '@parcel/source-map';

import type {FileSystem} from '@parcel/fs';
import type {FilePath} from '@parcel/types';

import typeof TypeScriptModule from 'typescript';
import typeof {ScriptTarget} from 'typescript';
import type {CompilerHost, CompilerOptions} from 'typescript';

class ParcelCompilerHost {
  fs: FileSystem;
  ts: TypeScriptModule;
  outputCode: ?string;
  outputMap: ?string;

  constructor(fs: FileSystem, ts: TypeScriptModule) {
    this.fs = fs;
    this.ts = ts;
  }

  getSourceFile(
    filePath: FilePath,
    languageVersion: $Values<ScriptTarget>,
    onError?: (message: string) => void
  ) {
    const sourceText = this.readFile(filePath);
    return sourceText !== undefined
      ? this.ts.createSourceFile(filePath, sourceText, languageVersion)
      : undefined;
  }

  getDefaultLibFileName() {
    return 'lib.d.ts';
  }

  writeFile(filePath: FilePath, content: string) {
    console.log('write', filePath);
    if (path.extname(filePath) === '.map') {
      this.outputMap = content;
    } else {
      this.outputCode = content;
    }
  }

  getCurrentDirectory() {
    return this.fs.cwd();
  }

  fileExists(filePath: FilePath) {
    try {
      return this.fs.statSync(filePath).isFile();
    } catch (err) {
      return false;
    }
  }

  readFile(filePath: FilePath) {
    try {
      return this.fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return undefined;
      }

      throw err;
    }
  }

  directoryExists(filePath: FilePath) {
    try {
      return this.fs.statSync(filePath).isDirectory();
    } catch (err) {
      return false;
    }
  }

  realpath(filePath: FilePath) {
    try {
      return this.fs.realpathSync(filePath);
    } catch (err) {
      return filePath;
    }
  }

  // getDirectories(filePath: FilePath) {
  //   return this.fs.readdirSync(filePath);
  // }

  getCanonicalFileName(fileName) {
    return this.ts.sys.useCaseSensitiveFileNames
      ? fileName
      : fileName.toLowerCase();
  }

  useCaseSensitiveFileNames() {
    return this.ts.sys.useCaseSensitiveFileNames;
  }

  getNewLine() {
    return this.ts.sys.newLine;
  }
}

export default new Transformer({
  async loadConfig({config}) {
    let configResult = await config.getConfig(['tsconfig.json']);

    config.setResult(configResult);
  },

  async transform({asset, config, options}) {
    let ts: TypeScriptModule = await options.packageManager.require(
      'typescript',
      asset.filePath
    );

    let opts: CompilerOptions = {
      // React is the default. Users can override this by supplying their own tsconfig,
      // which many TypeScript users will already have for typechecking, etc.
      jsx: 'React',
      ...config?.compilerOptions,
      // Always emit output
      noEmit: false,
      noEmitOnError: false,
      declaration: true,
      declarationMap: true,
      isolatedModules: false,
      emitDeclarationOnly: true,
      outFile: 'index.d.ts'
    };

    let host = new ParcelCompilerHost(options.inputFS, ts);
    let program = ts.createProgram([asset.filePath], opts, host);
    console.log(program);
    console.log(program.getSourceFiles());

    let includedFiles = program
      .getSourceFiles()
      .map(file => ({filePath: file.fileName}));

    let typeChecker = program.getTypeChecker();
    console.log(
      typeChecker.getSymbolAtLocation(program.getSourceFiles()[1]).exports
    );

    let res = program.emit();
    console.log(res);
    console.log(host.outputCode, host.outputMap);

    host.outputCode = host.outputCode.substring(
      0,
      host.outputCode.lastIndexOf('//# sourceMappingURL')
    );

    let map = JSON.parse(host.outputMap);
    map.sources = map.sources.map(source =>
      path.join(path.dirname(asset.filePath), source)
    );

    return [
      {
        type: 'ts',
        code: host.outputCode,
        map: await SourceMap.fromRawSourceMap(map),
        includedFiles
      }
    ];
  }
});
