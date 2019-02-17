module.exports = (() => {
  if (process.browser) {
    return require('./browser');
  }
  return require('./server');
})()
