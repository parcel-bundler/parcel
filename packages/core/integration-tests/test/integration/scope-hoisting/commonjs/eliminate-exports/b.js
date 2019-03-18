exports.foo = 2;
exports['bar'] = 3;

exports.setFoo = foo => {
  exports.foo = foo;
};
