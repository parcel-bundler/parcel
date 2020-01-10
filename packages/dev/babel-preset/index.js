module.exports = () => ({
  presets: [
    [
      require('@babel/preset-env'),
      {
        targets: {
          node: 8,
        },
      },
    ],
    require('@babel/preset-react'),
    require('@babel/preset-flow'),
  ],
  plugins: [
    require('@babel/plugin-proposal-class-properties'),
    require('@babel/plugin-proposal-nullish-coalescing-operator'),
    require('@babel/plugin-proposal-optional-chaining'),
  ],
  env: {
    production: {
      plugins: [
        // Inline the value of PARCEL_BUILD_ENV during production builds so that
        // it can be removed through dead code elimination below
        [
          'babel-plugin-transform-inline-environment-variables',
          {include: ['PARCEL_BUILD_ENV', 'AMPLITUDE_API_KEY']},
        ],
        'babel-plugin-minify-dead-code-elimination',
        [
          require('babel-plugin-module-resolver'),
          {
            alias: {
              '^@parcel/(.*)': x =>
                x[1] === 'watcher'
                  ? '@parcel/watcher'
                  : '@atlassian/parcel-' + x[1],
            },
          },
        ],
      ],
    },
  },
});
