'use strict';

// Node's `assert`, backed by the `assert` package, which isn't loaded until it's needed: it requires
// `util` for formatting failures, and with it `util`'s inspect and type checks, about 17 modules
// that cost far more to load in a fresh runtime than most callers spend asserting. The common
// assertions check the passing case here, and leave failing (and everything else) to the package.
var full;
function impl() {
  return full || (full = require('assert/build/assert.js'));
}

function assert(value) {
  if (!value || arguments.length === 0) impl().ok.apply(this, arguments);
}

assert.ok = function ok(value) {
  if (!value || arguments.length === 0) impl().ok.apply(this, arguments);
};

assert.equal = function equal(actual, expected) {
  // eslint-disable-next-line eqeqeq
  if (arguments.length < 2 || actual != expected) impl().equal.apply(this, arguments);
};

assert.notEqual = function notEqual(actual, expected) {
  // eslint-disable-next-line eqeqeq
  if (arguments.length < 2 || actual == expected) impl().notEqual.apply(this, arguments);
};

assert.strictEqual = function strictEqual(actual, expected) {
  if (arguments.length < 2 || !Object.is(actual, expected)) {
    impl().strictEqual.apply(this, arguments);
  }
};

assert.notStrictEqual = function notStrictEqual(actual, expected) {
  if (arguments.length < 2 || Object.is(actual, expected)) {
    impl().notStrictEqual.apply(this, arguments);
  }
};

// Everything else is the package's own, loaded on first access.
[
  'AssertionError',
  'deepEqual',
  'deepStrictEqual',
  'doesNotMatch',
  'doesNotReject',
  'doesNotThrow',
  'fail',
  'ifError',
  'match',
  'notDeepEqual',
  'notDeepStrictEqual',
  'rejects',
  'strict',
  'throws'
].forEach(function (name) {
  Object.defineProperty(assert, name, {
    configurable: true,
    enumerable: true,
    get: function () {
      var value = impl()[name];
      Object.defineProperty(assert, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: value
      });
      return value;
    },
    set: function (value) {
      Object.defineProperty(assert, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: value
      });
    }
  });
});

module.exports = assert;
