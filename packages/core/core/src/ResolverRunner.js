'use strict';
const resolveFrom = require('resolve-from');
const fs = require('fs');
const {promisify} = require('util');
const path = require('path');

const stat = promisify(fs.stat);

async function isDirectory(filePath) {
  try {
    let stats = await stat(filePath);
    return stats.isDirectory();
  } catch (err) {
    if (err.code !== 'ENOENT' || err.code === 'ENOTDIR') throw err;
    return false;
  }
}

class ResolverRunner {
  constructor() {
    // ...
  }

  // TODO: use resolver plugin to resolve
  async resolve(moduleRequest) {
    let {sourcePath, moduleSpecifier} = moduleRequest;
    let sourceDir = (await isDirectory(sourcePath))
      ? sourcePath
      : path.dirname(sourcePath);

    return resolveFrom(sourceDir, moduleSpecifier);
  }
}

module.exports = ResolverRunner;
