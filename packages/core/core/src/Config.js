import path from 'path';

export default class Config {
  constructor({
    searchPath,
    resolvedPath,
    result,
    includedFiles,
    invalidatingFiles,
    globPatterns,
    devDeps
  }) {
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

  setResolvedPath(filePath) {
    this.resolvedPath = filePath;
  }

  setResult(result: string) {
    this.result = result;
  }

  getContent() {
    return this.result;
  }

  addIncludedFile(filePath) {
    this.includedFiles.add(filePath);
  }

  addInvalidatingFile(filePath) {
    this.invalidatingFiles.add(filePath);
  }

  setDevDep(moduleName, moduleVersion) {
    this.devDeps.set(moduleName, moduleVersion);
  }

  getDevDepVersion(moduleName) {
    return this.devDeps.get(moduleName);
  }

  addGlobWatchPattern(glob) {
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
        resolveFrom: path.dirname(this.resolvedPath) // TODO: resolveFrom should be nearest package boundary
      });
    }

    return devDepRequests;
  }
}
