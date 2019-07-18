// @flow
import type {FilePath, PackageName, Glob} from '@parcel/types';

type ConfigOpts = {|
  searchPath: FilePath,
  resolvedPath?: FilePath,
  result?: any,
  includedFiles?: Set<FilePath>,
  watchGlob?: Glob,
  devDeps?: Map<PackageName, ?string>
|};

export default class Config {
  searchPath: FilePath;
  resolvedPath: ?FilePath;
  result: ?any;
  resultHash: ?string;
  includedFiles: Set<FilePath>;
  watchGlob: ?Glob;
  devDeps: Map<PackageName, ?string>;

  constructor({
    searchPath,
    resolvedPath,
    result,
    includedFiles,
    watchGlob,
    devDeps
  }: ConfigOpts) {
    this.searchPath = searchPath;
    this.resolvedPath = resolvedPath;
    this.result = result || null;
    this.includedFiles = includedFiles || new Set();
    this.watchGlob = watchGlob;
    this.devDeps = devDeps || new Map();
  }

  setResolvedPath(filePath: FilePath) {
    this.resolvedPath = filePath;
  }

  setResult(result: any) {
    this.result = result;
  }

  setResultHash(resultHash: string) {
    this.resultHash = resultHash;
  }

  addIncludedFile(filePath: FilePath) {
    this.includedFiles.add(filePath);
  }

  setDevDep(name: PackageName, version?: string) {
    this.devDeps.set(name, version);
  }

  getDevDepVersion(name: PackageName) {
    return this.devDeps.get(name);
  }

  setWatchGlob(glob: string) {
    this.watchGlob = glob;
  }

  // This will be more useful when we have edge types
  getInvalidations() {
    let invalidations = [];

    if (this.watchGlob) {
      invalidations.push({
        action: 'add',
        pattern: this.watchGlob
      });
    }

    for (let filePath of [this.resolvedPath, ...this.includedFiles]) {
      invalidations.push({
        action: 'change',
        pattern: filePath
      });

      invalidations.push({
        action: 'unlink',
        pattern: filePath
      });
    }

    return invalidations;
  }
}
