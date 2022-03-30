const fs = require('fs');
const path = require('path');
const otherFunction = require('./other/function')

module.exports = function () {
  const data = fs.readFileSync(path.join(__dirname, 'data', 'test.txt'), 'utf8')
  const firstDirnameTest = path.join(__dirname, 'data')
  const secondDirnameTest = path.join(__dirname, 'other-data')
  const firstFilenameTest = __filename
  const secondFilenameTest = `${__filename}?query-string=test`
  const other = otherFunction()

  return {
    data,
    firstDirnameTest,
    secondDirnameTest,
    firstFilenameTest,
    secondFilenameTest,
    other,
  }
}