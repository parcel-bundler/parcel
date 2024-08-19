module.exports = api => {
  let name = api.caller(caller => caller && caller.name);
  if (name === 'atlaspack') {
    return {
      presets: [require('@babel/preset-flow')],
      plugins: [
        // Inline the value of ATLASPACK_BUILD_ENV during self builds.
        // Atlaspack does not do this itself for node targets...
        [
          'babel-plugin-transform-inline-environment-variables',
          {include: ['ATLASPACK_BUILD_ENV']},
        ],
        'babel-plugin-minify-dead-code-elimination',
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
            node: 16,
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
          // Inline the value of ATLASPACK_BUILD_ENV during production builds so that
          // it can be removed through dead code elimination below
          [
            'babel-plugin-transform-inline-environment-variables',
            {
              include: [
                'ATLASPACK_BUILD_ENV',
                'SKIP_PLUGIN_COMPATIBILITY_CHECK',
                // Eliminate the ATLASPACK_SELF_BUILD environment variable to get
                //  rid of @babel/register in bin.js, when compiling with gulp.
                ...(!process.env.ATLASPACK_SELF_BUILD
                  ? ['ATLASPACK_SELF_BUILD']
                  : []),
              ],
            },
          ],
          'babel-plugin-minify-dead-code-elimination',
        ],
      },
    },
  };
};
