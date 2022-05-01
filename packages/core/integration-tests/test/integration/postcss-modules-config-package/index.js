require('./index.css');
var foo = require('./foo');

module.exports = function () {
  return foo.foo;
};
