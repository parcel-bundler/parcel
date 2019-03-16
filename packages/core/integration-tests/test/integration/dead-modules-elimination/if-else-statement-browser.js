module.exports = (() => {
  if (process.browser) {
    return require('./dep1');
  } else {
    return require('./dep2');
  }
})();
