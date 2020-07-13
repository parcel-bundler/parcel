// @flow
import type {FileSystem} from '@parcel/fs';
import type {FilePath} from '@parcel/types';
import type {PluginLogger} from '@parcel/logger';
import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import typeof {ScriptTarget} from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import type {CompilerOptions} from 'typescript';
import path from 'path';
import {FSHost} from './FSHost';

export class CompilerHost extends FSHost {
  outputCode: ?string;
  outputMap: ?string;
  logger: PluginLogger;
  // workaround for https://github.com/microsoft/TypeScript/issues/39547
  redirectTypes: Map<FilePath, FilePath> = new Map();

  constructor(fs: FileSystem, ts: TypeScriptModule, logger: PluginLogger) {
    super(fs, ts);
    this.logger = logger;
  }

  readFile(filePath: FilePath) {
    let contents = super.readFile(filePath);
    if (contents && path.basename(filePath) === 'package.json') {
      let json = JSON.parse(contents);
      if (
        json.types != null &&
        json.source != null &&
        !super.fileExists(path.join(path.dirname(filePath), json.types))
      ) {
        let source = path.join(path.dirname(filePath), json.source);
        let fakeTypes = source.slice(0, -path.extname(source).length) + '.d.ts';
        this.redirectTypes.set(fakeTypes, source);
        json.types = fakeTypes;
        this.logger.verbose({
          message: `Faking missing \`types\` field in ${filePath} to be ${source}`,
        });
        return JSON.stringify(json);
      }
    }
    return contents;
  }

  fileExists(filePath: FilePath) {
    if (this.redirectTypes.has(filePath)) {
      return true;
    } else {
      return super.fileExists(filePath);
    }
  }

  getSourceFile(filePath: FilePath, languageVersion: $Values<ScriptTarget>) {
    let redirect = this.redirectTypes.get(filePath);
    if (redirect != null) {
      const sourceText = this.readFile(redirect);
      return sourceText !== undefined
        ? this.ts.createSourceFile(filePath, sourceText, languageVersion)
        : undefined;
    }

    const sourceText = this.readFile(filePath);
    return sourceText !== undefined
      ? this.ts.createSourceFile(filePath, sourceText, languageVersion)
      : undefined;
  }

  getDefaultLibFileName(options: CompilerOptions) {
    return this.ts.getDefaultLibFilePath(options);
  }

  writeFile(filePath: FilePath, content: string) {
    if (path.extname(filePath) === '.map') {
      this.outputMap = content;
    } else {
      this.outputCode = content;
    }
  }

  getCanonicalFileName(fileName: FilePath) {
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
