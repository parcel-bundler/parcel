var foo;
(function (foo) {
  foo["bar"] = "bar";
})(foo = exports.foo || (exports.foo = {}));
output = exports;
