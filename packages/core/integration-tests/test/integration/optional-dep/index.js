try {
  require('optional-dep');
} catch (err) {
  module.exports = err;
}
