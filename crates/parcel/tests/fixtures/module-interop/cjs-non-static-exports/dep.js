function addProps(e) {
  e.foo = 2;
}
addProps(exports);
exports.bar = 4;
exports.baz = exports.bar + 2;
