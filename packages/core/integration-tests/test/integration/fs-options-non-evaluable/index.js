const dir = __dirname

module.exports = require('fs').readFileSync(dir + '/test.txt', {
  encoding: (typeof Date.now()).replace(/number/, 'utf-8')
})
