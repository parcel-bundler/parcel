module.exports = (() => {
  const falsy1 = () => false;
  const falsy2 = () => false;
  if (falsy1() || process.browser || falsy2()) {
    return require('./dep1');
  } else {
    return require('./dep2');
  }
})();
