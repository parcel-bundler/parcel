require('./index.css');
var map = require('./foo.module.css');

module.exports = function () {
  return map.foo;
};
