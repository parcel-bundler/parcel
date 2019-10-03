const {Transform} = require('stream');
const babel = require('gulp-babel');
const gulp = require('gulp');
const merge = require('merge-stream');
const path = require('path');
const rimraf = require('rimraf');
const babelConfig = require('./babel.config.js');

const IGNORED_PACKAGES = [
  '!packages/examples/**',
  '!packages/core/integration-tests/**',
  '!packages/core/workers/test/integration/**',
  '!packages/core/is-v2-ready-yet/**',
  '!packages/core/test-utils/**',
  '!packages/core/types/**'
];

const paths = {
  packageSrc: [
    'packages/*/*/src/**/*.js',
    '!packages/*/scope-hoisting/src/helpers.js',
    '!**/loaders/**',
    '!**/prelude.js',
    ...IGNORED_PACKAGES
  ],
  packageOther: [
    'packages/*/scope-hoisting/src/helpers.js',
    'packages/*/*/src/**/loaders/**',
    'packages/*/*/src/**/prelude.js',
    'packages/*/dev-server/src/templates/**'
  ],
  packages: 'packages/'
};

exports.clean = function clean(cb) {
  rimraf('packages/*/*/lib/**', cb);
};

exports.default = exports.build = function build() {
  return merge(
    gulp
      .src(paths.packageSrc)
      .pipe(babel(babelConfig))
      .pipe(renameStream(relative => relative.replace('src', 'lib')))
      .pipe(gulp.dest(paths.packages)),
    gulp
      .src(paths.packageOther)
      .pipe(renameStream(relative => relative.replace('src', 'lib')))
      .pipe(gulp.dest(paths.packages))
  );
};

function renameStream(fn) {
  return new TapStream(vinyl => {
    let relative = path.relative(vinyl.base, vinyl.path);
    vinyl.path = path.join(vinyl.base, fn(relative));
  });
}

/*
 * "Taps" into the contents of a flowing stream, yielding chunks to the passed
 * callback. Continues to pass data chunks down the stream.
 */
class TapStream extends Transform {
  constructor(tap, options) {
    super({...options, objectMode: true});
    this._tap = tap;
  }

  _transform(chunk, encoding, callback) {
    try {
      this._tap(chunk);
      callback(null, chunk);
    } catch (err) {
      callback(err);
    }
  }
}
