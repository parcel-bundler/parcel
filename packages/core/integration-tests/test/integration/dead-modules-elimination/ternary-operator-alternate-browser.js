module.exports = (() => {
  return !process.browser ? require('./dep2') : require('./dep1');
})();
