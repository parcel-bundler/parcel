module.exports = (() => {
  if (!process.browser) {
    return require('./dep2');
  } else {
    return require('./dep1');
  }
})();
