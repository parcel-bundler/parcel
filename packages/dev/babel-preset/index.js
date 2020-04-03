module.exports = () => ({
  presets: [
    [
      require('@babel/preset-env'),
      {
        modules: false,
        targets: 'Chrome 75',
      },
    ],
    require('@babel/preset-flow'),
  ],
  plugins: [
    require('@babel/plugin-proposal-class-properties'),
    require('@babel/plugin-proposal-nullish-coalescing-operator'),
    require('@babel/plugin-proposal-optional-chaining'),
    // [
    //   require('@babel/plugin-transform-modules-commonjs'),
    //   {
    //     lazy: () => process.env.NODE_ENV !== 'test',
    //   },
    // ],
    [
      require('@babel/plugin-transform-react-jsx'),
      {
        pragma: 'h',
        pragmaFrag: 'Fragment',
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
