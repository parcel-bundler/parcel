const fs = require('fs');
const path = require('path');

module.exports = function () {
  return fs.readFileSync(path.join(__dirname, '..', 'data', 'test.txt'), 'utf8')
}