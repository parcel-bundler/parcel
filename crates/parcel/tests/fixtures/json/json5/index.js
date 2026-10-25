var data = require('./data.json5');
var local = require('./local.json');

module.exports = function () {
  return [data, local];
};
