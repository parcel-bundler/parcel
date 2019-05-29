;(function () {
  module.exports = test

  function test(data) {
    if (typeof Buffer === 'function' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(data)) {
      return true;
    }
    return false;
  }
})();
