const {promisify} = require('@parcel/utils');
const fs = require('./fs-native');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');

exports.readFile = promisify(fs.readFile);
exports.readFileSync = fs.readFileSync;
exports.writeFile = promisify(fs.writeFile);
exports.stat = promisify(fs.stat);
exports.readdir = promisify(fs.readdir);
exports.unlink = promisify(fs.unlink);
exports.rimraf = promisify(rimraf);
exports.realpath = async function(path) {
  const realpath = promisify(fs.realpath);
  try {
    path = await realpath(path);
  } catch (e) {
    // do nothing
  }
  return path;
};
if (fs.lstat) {
  exports.lstat = promisify(fs.lstat);
} else {
  exports.lstat = promisify(fs.stat);
}

exports.exists = function(filename) {
  return new Promise(resolve => {
    fs.exists(filename, resolve);
  });
};

exports.mkdirp = promisify(mkdirp);
exports.createWriteStream = path => fs.createWriteStream(path);
exports.createReadStream = path => fs.createReadStream(path);
