// @flow
import type {FileSystem} from '@parcel/fs';
import type {FilePath} from '@parcel/types';
import typeof TypeScriptModule from 'typescript';
import typeof {ScriptTarget} from 'typescript';
import path from 'path';

export class ParcelCompilerHost {
  fs: FileSystem;
  ts: TypeScriptModule;
  outputCode: ?string;
  outputMap: ?string;

  constructor(fs: FileSystem, ts: TypeScriptModule) {
    this.fs = fs;
    this.ts = ts;
  }

  getSourceFile(filePath: FilePath, languageVersion: $Values<ScriptTarget>) {
    const sourceText = this.readFile(filePath);
    return sourceText !== undefined
      ? this.ts.createSourceFile(filePath, sourceText, languageVersion)
      : undefined;
  }

  getDefaultLibFileName() {
    return 'lib.d.ts';
  }

  writeFile(filePath: FilePath, content: string) {
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
