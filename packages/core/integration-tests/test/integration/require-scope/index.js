const test = {
  unaryFnExpr: 'test failed',
  fnExpr: 'test failed',
  fnDecl: 'test failed',
  varDecl: 'test failed',
  topVarDecl: 'test failed'
};

module.exports.test = test;

function main(require) {
  require('test passed');
}

main(x => test.fnDecl = x);

(function(require) {
  require('test passed')
})(x => test.fnExpr = x);

void function main(require) {
  require('test passed');
}(x => test.unaryFnExpr = x);

void function main() {
  const require = x => test.varDecl = x

  require('test passed')
}()

function require(x) {
  return test.topVarDecl = x;
}

require('test passed')
