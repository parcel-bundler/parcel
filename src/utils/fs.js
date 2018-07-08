const promisify = require('./promisify');
const fs = require('fs');
const mkdirp = require('mkdirp');

exports.readFile = promisify(fs.readFile);
exports.writeFile = promisify(fs.writeFile);
exports.stat = promisify(fs.stat);
exports.readdir = promisify(fs.readdir);
exports.unlink = promisify(fs.unlink);
exports.realpath = async function(path) {
  const realpath = promisify(fs.realpath);
  try {
    path = await realpath(path);
  } catch (e) {
    // do nothing
  }
  return path;
};
exports.lstat = promisify(fs.lstat);

exports.exists = function(filename) {
  return new Promise(resolve => {
    fs.exists(filename, resolve);
  });
};

exports.mkdirp = promisify(mkdirp);
