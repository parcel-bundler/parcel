var test = require('./other');

module.exports = {
  hi: () => "Hi",
  hello: () => "HELLO",
  b: () => test.hello()
}
