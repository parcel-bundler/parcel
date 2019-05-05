module.exports = (() => {
  const falsy1 = () => false;
  const falsy2 = () => false;
  if (falsy1() || process.browser && falsy2()) {
    return require('./dep2');
  } else {
    return require('./dep1');
  }
})();
