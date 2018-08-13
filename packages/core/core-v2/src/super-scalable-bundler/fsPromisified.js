const fs = require('fs');
const { promisify } = require('util');
const mkdirpCb = require('mkdirp');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);
const mkdirp = promisify(mkdirpCb);
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

module.exports = {
  readFile,
  writeFile,
  appendFile,
  mkdirp,
  stat,
  isDirectory,
}
