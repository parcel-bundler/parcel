var map1 = require('./composes-1.module.css');
var map2 = require('./composes-2.module.css');

module.exports = function () {
  return Object.assign({}, map1, map2);
};
