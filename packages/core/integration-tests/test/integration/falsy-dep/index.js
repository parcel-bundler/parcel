if (false) {
  require('if-false-optional-dep');
}

if (false) {
  globalStuff(() =>
    require('if-false-optional-dep-deep')
  );
}

if ('') {
  require('if-falsy-optional-dep');
}

if (process.env.NODE_ENV === 'test') {
  require('./true-consequent');
} else {
  require('./false-alternate');
}

if (process.env.NODE_ENV !== 'test') {
  require('./false-consequent');
} else {
  require('./true-alternate');
}

module.exports = 2;
