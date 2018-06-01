function p() {
  return require('./b');
}
module.exports.foo = 'foo'
module.exports = p();
