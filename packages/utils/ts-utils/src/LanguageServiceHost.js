// @flow
import type {FileSystem} from '@parcel/fs';
import type {FilePath} from '@parcel/types';
import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import type {ParsedCommandLine} from 'typescript';
import {FSHost} from './FSHost';

export class LanguageServiceHost extends FSHost {
  config: ParsedCommandLine;
  files: {[key: string]: {version: number, ...}, ...};

  constructor(fs: FileSystem, ts: TypeScriptModule, config: ParsedCommandLine) {
    super(fs, ts);
    this.config = config;
    this.files = {};
  }

  invalidate(fileName: FilePath) {
    const entry = this.files[fileName];

    if (entry) {
      entry.version++;
    } else {
      this.files[fileName] = {
        version: 0
      };
    }
  }

  getScriptFileNames() {
    return this.config.fileNames;
  }

  getScriptVersion(fileName: FilePath) {
    return this.files[fileName] && this.files[fileName].version.toString();
  }

  getScriptSnapshot(fileName: string) {
    if (!this.fileExists(fileName)) {
      return;
    }

    const content = this.readFile(fileName);

    if (content) {
      // $FlowFixMe
      return this.ts.ScriptSnapshot.fromString(content);
    }
  }

  getCompilationSettings() {
    return this.config.options;
  }

  getDefaultLibFileName(projectOptions: any) {
    return this.ts.getDefaultLibFilePath(projectOptions);
  }
}
