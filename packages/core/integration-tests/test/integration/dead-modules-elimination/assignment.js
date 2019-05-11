function init(options) {
  process.env.FOO = options.foo;
  process.env.BAR = options.bar;
  process.env.BAZ = options.baz;

  return process.env.FOO + ':' + process.env.BAR + ':' + process.env.BAZ;
}

module.exports = init({
  foo: '3',
  bar: '4',
  baz: '5'
});
