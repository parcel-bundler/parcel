// @flow
import type {ParsedCommandLine} from 'typescript';

type FileNames = Array<string>;
type ReadFileFunc = (path: string, encoding?: string) => string | void;
type FileExistsFunc = (path: string) => boolean;
type ReadDirectoryFunc = (
  path: string,
  extensions?: $ReadOnlyArray<string>,
  exclude?: $ReadOnlyArray<string>,
  include?: $ReadOnlyArray<string>,
  depth?: number
) => string[];

export default class LanguageServiceHost {
  // Instance of typescript module
  ts: any;

  options: ParsedCommandLine;
  fileNames: FileNames;
  fileExists: FileExistsFunc;
  readFile: ReadFileFunc;
  readDirectory: ReadDirectoryFunc;
  files: {[key: string]: {version: number, ...}, ...};
  baseDir: string;

  constructor(
    {
      fileNames,
      options
    }: {
      fileNames: FileNames,
      options: ParsedCommandLine,
      ...
    },
    ts: any,
    baseDir: string
  ) {
    this.options = options;
    this.fileNames = fileNames;
    this.fileExists = ts.sys.fileExists;
    this.readFile = ts.sys.readFile;
    this.readDirectory = ts.sys.readDirectory;
    this.files = {};
    this.ts = ts;
    this.baseDir = baseDir;
  }

  invalidate(fileName: string) {
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
    return this.fileNames;
  }

  getScriptVersion(fileName: string) {
    return this.files[fileName] && this.files[fileName].version.toString();
  }

  getScriptSnapshot(fileName: string) {
    if (!this.ts.sys.fileExists(fileName)) {
      return;
    }

    const content = this.ts.sys.readFile(fileName);

    if (content) {
      return this.ts.ScriptSnapshot.fromString(content);
    }
  }

  getCurrentDirectory() {
    return this.baseDir;
  }

  getCompilationSettings() {
    return this.options;
  }

  getDefaultLibFileName(projectOptions: any) {
    return this.ts.getDefaultLibFilePath(projectOptions);
  }
}
