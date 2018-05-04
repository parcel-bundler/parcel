const Resolver = require('../Resolver');
const syncPromise = require('../utils/syncPromise');
const path = require('path');
const fs = require('../utils/fs');

module.exports = function(less, options) {
  const FileManager = less.FileManager;
  const resolver = new Resolver({
    extensions: ['.less'],
    rootDir: options.rootDir
  });

  function LessFileManager() {}

  LessFileManager.prototype = new FileManager();

  LessFileManager.prototype.resolve = async function(
    filename,
    currentDirectory
  ) {
    return (await resolver.resolve(
      filename,
      path.join(currentDirectory, 'index')
    )).path;
  };

  LessFileManager.prototype.loadFile = async function(
    filename,
    currentDirectory
  ) {
    filename = await this.resolve(filename, currentDirectory);
    let contents = (await fs.readFile(filename)).toString();
    return {contents, filename};
  };

  LessFileManager.prototype.loadFileSync = function(
    filename,
    currentDirectory
  ) {
    return syncPromise(this.loadFile(filename, currentDirectory));
  };

  return LessFileManager;
};
