// @flow
import type {FilePath} from '@parcel/types';
import type {CompilerOptions} from 'typescript';
import typeof {ScriptTarget} from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import path from 'path';
import {FSHost} from './FSHost';

export class CompilerHost extends FSHost {
  outputCode: ?string;
  outputMap: ?string;

  getSourceFile(filePath: FilePath, languageVersion: $Values<ScriptTarget>) {
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
