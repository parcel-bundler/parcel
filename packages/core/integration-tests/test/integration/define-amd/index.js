if (typeof define === 'function' && define.amd) {
  define(() => 4);
} else if (typeof module === 'object') {
  module.exports = 2;
}
