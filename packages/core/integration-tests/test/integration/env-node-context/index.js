const fs = require('fs');
const path = require('path');

module.exports = function () {
  const data = fs.readFileSync(path.join(__dirname, 'data', 'test.txt'), 'utf8')
  const resolveTest = `${__dirname}/data`
  const filename = __filename

  return {
    data,
    filename,
    resolveTest,
  }
}