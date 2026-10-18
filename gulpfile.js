const {Transform} = require('stream');
const gulp = require('gulp');
const path = require('path');
const {rimraf} = require('rimraf');
const swc = require('@swc/core');

const paths = {
  packageTS: [
    'packages-v3/*/src/**/*.{ts,tsx}',
    '!packages-v3/*/src/**/*.d.ts',
    // RSC ships its TypeScript source; only declarations are built.
    '!packages-v3/rsc/**',
  ],
  // Packages that publish type declarations.
  packageDts: [
    'packages-v3/plugin/src/*.ts',
    'packages-v3/rsc/src/*.tsx',
    '!packages-v3/*/src/**/*.d.ts',
  ],
  packages: 'packages-v3/',
};

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

exports.clean = function clean(cb) {
  rimraf('packages-v3/*/lib', {glob: true}).then(
    () => cb(),
    err => cb(err),
  );
};

exports.default = exports.build = gulp.parallel(buildTS, buildDts);

function buildTS() {
  return gulp
    .src(paths.packageTS)
    .pipe(
      new TapStream(vinyl => {
        let result = swc.transformSync(vinyl.contents.toString(), {
          filename: vinyl.path,
          jsc: {
            parser: {
              syntax: 'typescript',
              tsx: vinyl.path.endsWith('.tsx'),
            },
            target: 'es2024',
          },
        });

        vinyl.contents = Buffer.from(result.code);
      }),
    )
    .pipe(renameStream(relative => toLib(relative, '.js')))
    .pipe(gulp.dest(paths.packages));
}

function buildDts() {
  return gulp
    .src(paths.packageDts, {base: paths.packages})
    .pipe(
      new TapStream(vinyl => {
        let result = swc.transformSync(vinyl.contents.toString(), {
          filename: vinyl.path,
          jsc: {
            parser: {
              syntax: 'typescript',
              tsx: vinyl.path.endsWith('.tsx'),
            },
            target: 'esnext',
            experimental: {
              emitIsolatedDts: true,
            },
          },
        });

        let output = JSON.parse(result.output);
        vinyl.contents = Buffer.from(output.__swc_isolated_declarations__);
      }),
    )
    .pipe(renameStream(relative => toLib(relative, '.d.ts')))
    .pipe(gulp.dest(paths.packages));
}

// Maps <pkg>/src/<file>.ts(x) to <pkg>/lib/<file><ext>.
function toLib(relative, ext) {
  let [pkg, , ...rest] = relative.split(path.sep);
  return path.join(pkg, 'lib', ...rest).replace(/\.tsx?$/, ext);
}

function renameStream(fn) {
  return new TapStream(vinyl => {
    let relative = path.relative(vinyl.base, vinyl.path);
    vinyl.path = path.join(vinyl.base, fn(relative));
  });
}
