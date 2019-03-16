module.exports = (() => {
  if (!process.browser) {
    return require('./dep2');
  }
  return require('./dep1');
})();
