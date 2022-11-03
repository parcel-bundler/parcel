function foo(e) {
  e.foo = 2;
}

foo(exports);
exports.bar = 4;
exports.baz = exports.bar + 2;
