module.exports = (() => {
  const falsy1 = () => false;
  const falsy2 = () => false;
  if (falsy1() || falsy2() || process.browser) {
    return require('./dep1');
  } else {
    return require('./dep2');
  }
})();
