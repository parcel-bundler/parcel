const es6 = require('./es6');

module.exports = function (code, opts) {
  return es6('module.exports = ' + code + ';', opts);
};
