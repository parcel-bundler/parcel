module.exports = (() => {
  return process.browser ? require('./dep1') : require('./dep2');
})();
