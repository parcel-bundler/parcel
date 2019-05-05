module.exports = (() => {
  const falsy1 = () => false;
  const falsy2 = () => false;
  if (process.browser || falsy1() || falsy2()) {
    return require('./dep1');
  } else {
    return require('./dep2');
  }
})();
