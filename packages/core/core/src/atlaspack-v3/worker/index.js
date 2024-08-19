if (
  process.env.ATLASPACK_BUILD_ENV !== 'production' ||
  process.env.ATLASPACK_SELF_BUILD
) {
  require('@atlaspack/babel-register');
}

require('./worker');
