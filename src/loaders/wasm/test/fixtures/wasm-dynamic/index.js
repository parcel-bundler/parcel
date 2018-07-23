module.exports = import('./dynamic').then(function (add) {
  return add(2, 3);
});
