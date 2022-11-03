module.exports = api => {
  let name = api.caller(caller => caller && caller.name);
  if (name === 'parcel') {
    return {
      presets: [require('@babel/preset-flow')],
      plugins: [
        // Inline the value of PARCEL_BUILD_ENV during self builds.
        // Parcel does not do this itself for node targets...
        [
          require('babel-plugin-transform-inline-environment-variables'),
          {include: ['PARCEL_BUILD_ENV']},
        ],
        require('babel-plugin-minify-dead-code-elimination'),
      ],
    };
  }

  return {
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
            require('babel-plugin-transform-inline-environment-variables'),
            {
              include: [
                'PARCEL_BUILD_ENV',
                // Eliminate the PARCEL_SELF_BUILD environment variable to get
                //  rid of @babel/register in bin.js, when compiling with gulp.
                ...(!process.env.PARCEL_SELF_BUILD
                  ? ['PARCEL_SELF_BUILD']
                  : []),
              ],
            },
          ],
          require('babel-plugin-minify-dead-code-elimination'),
        ],
      },
    },
  };
};
