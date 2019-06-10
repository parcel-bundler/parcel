import * as ts from 'typescript';

export default class LanguageServiceHost {
  constructor({fileNames, options}) {
    this.options = options;
    this.fileNames = fileNames;
    this.fileExists = ts.sys.fileExists;
    this.readFile = ts.sys.readFile;
    this.readDirectory = ts.sys.readDirectory;
    this.files = {};
  }

  invalidate(file) {
    const entry = this.files[file];

    if (entry) {
      entry.version++;
    } else {
      this.files[file] = {
        version: 0
      };
    }
  }

  getScriptFileNames() {
    return this.fileNames;
  }

  getScriptVersion(fileName) {
    return this.files[fileName] && this.files[fileName].version.toString();
  }

  getScriptSnapshot(fileName) {
    if (!ts.sys.fileExists(fileName)) {
      return;
    }

    const content = ts.sys.readFile(fileName);

    if (content) {
      return ts.ScriptSnapshot.fromString(content);
    }
  }

  getCurrentDirectory() {
    return process.cwd();
  }

  getCompilationSettings() {
    return this.options;
  }

  getDefaultLibFileName(projectOptions) {
    return ts.getDefaultLibFilePath(projectOptions);
  }
}
