const promisify = require('./promisify');
const fs = require('fs');
const mkdirp = require('mkdirp');

exports.readFile = promisify(fs.readFile);
exports.writeFile = promisify(fs.writeFile);
exports.stat = promisify(fs.stat);
exports.readdir = promisify(fs.readdir);
exports.unlink = promisify(fs.unlink);
exports.realpath = promisify(fs.realpath);

exports.exists = function(filename) {
  return new Promise(resolve => {
    fs.exists(filename, resolve);
  });
};

exports.mkdirp = promisify(mkdirp);
