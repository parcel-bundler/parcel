const gulp = require('gulp');
const babel = require('gulp-babel');
const rimraf = require('rimraf');
const clone = require('gulp-clone');
const merge = require('merge-stream');
const cache = require('gulp-cached');
const path = require('path');
const {Transform} = require('stream');

const babelConfig = require('./babel.config.js');

const paths = {
  src: [
    'packages/*/*/src/**/*.js',
    '!packages/examples/**/*',
    '!packages/core/integration-tests/**/*'
  ],
  dest: 'packages'
};

exports.clean = function clean(cb) {
  return rimraf('packages/*/*/lib', cb);
};

function build() {
  const sources = gulp
    .src(paths.src)
    .pipe(cache('build', {optimizeMemory: true}));

  // See example of merging cloned streams at gulp-clone README:
  // https://github.com/mariocasciaro/gulp-clone/blob/4476fcf34a5336c2d33c2fc4a6ab2cd163e302e7/README.md
  // Which is licensed MIT
  return merge(
    sources
      .pipe(clone())
      .pipe(
        renameStream(relative =>
          relative.replace('src', 'lib').replace(/\.js$/, '.js.flow')
        )
      )
      .pipe(gulp.dest(paths.dest)),
    sources
      .pipe(clone())
      .pipe(babel(babelConfig))
      .pipe(renameStream(relative => relative.replace('src', 'lib')))
      .pipe(gulp.dest(paths.dest))
  );
}

exports.default = gulp.series(exports.clean, build);

exports.watch = gulp.series(build, function watch() {
  gulp.watch(paths.src, build);
});

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
