const fs = require('fs');
const path = require('path');

module.exports = function () {
  const data = fs.readFileSync(path.join(__dirname, 'data', 'test.txt'), 'utf8')
  const firstDirnameTest = path.join(__dirname, 'data')
  const secondDirnameTest = path.join(__dirname, 'other-data')
  const firstFilenameTest = __filename
  const secondFilenameTest = `${__filename}?query-string=test`

  return {
    data,
    firstDirnameTest,
    secondDirnameTest,
    firstFilenameTest,
    secondFilenameTest
  }
}