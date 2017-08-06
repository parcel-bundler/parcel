const promisify = require('./promisify');
const fs = require('fs');

exports.readFile = promisify(fs.readFile);
exports.writeFile = promisify(fs.writeFile);
// exports.exists = promisify(fs.exists);

exports.exists = function (filename) {
  return new Promise((resolve) => {
    fs.exists(filename, resolve);
  });
};
