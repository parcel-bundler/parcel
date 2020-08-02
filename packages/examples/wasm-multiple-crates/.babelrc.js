/**
 * NOTE: this *must* be in a `.babelrc` or `.babelrc.js` file
 * @see: https://github.com/parcel-bundler/parcel/blob/master/packages/core/parcel-bundler/src/transforms/babel/babelrc.js#L73
 */
module.exports = {
  plugins: ['@babel/transform-runtime'],
  presets: [
    [
      '@babel/env',
      {
        useBuiltIns: 'usage',
        targets: '> 0.5%, last 1 version, not dead',
      },
    ],
  ],
};
