// @flow
import nullthrows from 'nullthrows';
import path from 'path';

import type {FilePath, PackageName} from '@parcel/types';

type ConfigOpts = {|
  searchPath: FilePath,
  resolvedPath?: FilePath,
  result?: any,
  includedFiles?: Iterator<FilePath>,
  invalidatingFiles?: Iterator<FilePath>,
  globPatterns?: Iterator<string>,
  devDeps?: Iterator<[PackageName, ?string]>
|};

export default class Config {
  searchPath: FilePath;
  resolvedPath: ?FilePath;
  result: ?any;
  includedFiles: Set<FilePath>;
  invalidatingFiles: Set<FilePath>;
  globPatterns: Set<string>;
  devDeps: Map<PackageName, ?string>;

  constructor({
    searchPath,
    resolvedPath,
    result,
    includedFiles,
    invalidatingFiles,
    globPatterns,
    devDeps
  }: ConfigOpts) {
    this.searchPath = searchPath;
    this.resolvedPath = resolvedPath;
    this.result = result || null;
    this.includedFiles = new Set(includedFiles);
    this.invalidatingFiles = new Set(invalidatingFiles);
    this.globPatterns = new Set(globPatterns);
    this.devDeps = new Map(devDeps);
  }

  serialize() {
    return {
      searchPath: this.searchPath,
      resolvedPath: this.resolvedPath,
      result: this.result,
      includedFiles: [...this.includedFiles],
      invalidatingFiles: [...this.invalidatingFiles],
      globPatterns: [...this.globPatterns],
      devDeps: [...this.devDeps]
    };
  }

  setResolvedPath(filePath: FilePath) {
    this.resolvedPath = filePath;
  }

  setResult(result: any) {
    this.result = result;
  }

  getContent() {
    return this.result;
  }

  addIncludedFile(filePath: FilePath) {
    this.includedFiles.add(filePath);
  }

  addInvalidatingFile(filePath: FilePath) {
    this.invalidatingFiles.add(filePath);
  }

  setDevDep(name: PackageName, version?: string) {
    this.devDeps.set(name, version);
  }

  getDevDepVersion(name: PackageName) {
    return this.devDeps.get(name);
  }

  addGlobWatchPattern(glob: string) {
    this.globPatterns.add(glob);
  }

  getInvalidations() {
    let invalidations = [];

    for (let globPattern of this.globPatterns) {
      invalidations.push({
        action: 'add',
        pattern: globPattern
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

  getDevDepRequests() {
    let devDepRequests = [];
    for (let [moduleSpecifier] of this.devDeps) {
      devDepRequests.push({
        moduleSpecifier,
        resolveFrom: path.dirname(nullthrows(this.resolvedPath)) // TODO: resolveFrom should be nearest package boundary
      });
    }

    return devDepRequests;
  }
}
