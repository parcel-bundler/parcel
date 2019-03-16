module.exports = (() => {
  if (process.browser) {
    return require('./dep1');
  }
  return require('./dep2');
})();
