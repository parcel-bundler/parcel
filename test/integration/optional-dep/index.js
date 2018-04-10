try {
  require('try-optional-dep');
} catch (err) {
  module.exports = err;
}

if(false) {
  require('if-false-optional-dep');
}

if(false) {
  globalStuff(() =>
    require('if-false-optional-dep-deep')
  )
}

if('') {
  require('if-falsy-optional-dep');
}
