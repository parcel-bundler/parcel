const promisify = require('./promisify');
const fs = require('fs');
const mkdirp = require('mkdirp');

exports.readFile = promisify(fs.readFile);
exports.writeFile = promisify(fs.writeFile);
exports.stat = promisify(fs.stat);

exports.exists = function(filename) {
  return new Promise(resolve => {
    fs.access(filename, err => {
      if (err && err.code === 'ENOENT') {
        return resolve(false);
      }
      return resolve(true);
    });
  });
};

exports.existsSync = fs.existsSync;

exports.mkdirp = promisify(mkdirp);
