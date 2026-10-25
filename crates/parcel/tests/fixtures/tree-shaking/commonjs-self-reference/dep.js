exports.a = 'a';
module.exports.b = 'b';
this.c = 'c';
exports.counter = 0;

exports.used = function () {
  exports.counter += 1;
  return [exports.a, module.exports.b, exports.counter];
};
this.usedThis = this.c;

exports.unused = function () {
  return 'unused-sentinel';
};
