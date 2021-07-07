module.exports = () => ({
  presets: [
    [
      require('@babel/preset-env'),
      {
        modules: false,
        targets: {
          node: 12,
        },
      },
    ],
    require('@babel/preset-react'),
    require('@babel/preset-flow'),
  ],
  plugins: [
    [
      require('@babel/plugin-transform-modules-commonjs'),
      {
        lazy: true,
      },
    ],
  ],
  env: {
    production: {
      plugins: [
        // Inline the value of PARCEL_BUILD_ENV during production builds so that
        // it can be removed through dead code elimination below
        [
          'babel-plugin-transform-inline-environment-variables',
          {include: ['PARCEL_BUILD_ENV']},
        ],
        'babel-plugin-minify-dead-code-elimination',
      ],
    },
  },
});
