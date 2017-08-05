const promisify = require('./promisify');
const fs = require('fs');

exports.readFile = promisify(fs.readFile);
exports.writeFile = promisify(fs.writeFile);
