import path from 'path';

export default class Config {
  constructor(searchPath) {
    this.searchPath = searchPath;
    this.result = null;
    this.includedFiles = new Set();
    this.invalidatingFiles = new Set();
    this.globPatterns = new Set();
    this.devDeps = new Map();
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
