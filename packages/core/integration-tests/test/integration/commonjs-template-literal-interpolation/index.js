const fn = 'add';

module.exports = function (a, b) {
  const add = require(`lodash/${fn}`);

  return add(a, b);
};
