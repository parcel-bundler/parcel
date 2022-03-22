const fs = require('fs');
const path = require('path');

module.exports = function () {
  const data = fs.readFileSync(path.join(__dirname, 'data', 'test.txt'), 'utf8')
  const dirnameTest = `${__dirname}/data`
  const filenameTest = __filename

  return {
    data,
    filenameTest,
    dirnameTest,
  }
}