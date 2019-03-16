var map1 = require('./composes-1.css');
var map2 = require('./composes-2.css');

module.exports = function () {
  return Object.assign({}, map1, map2);
};
