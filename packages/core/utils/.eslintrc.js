const RESTRICTED_CONFIG = [
  'error',
  {
    paths: [
      {
        name: '@atlaspack/workers',
        message:
          'Do not import workers inside utils. Instead, create a separate package.',
      },
    ],
  },
];

module.exports = {
  extends: '@atlaspack/eslint-config',
  rules: {
    'no-restricted-imports': RESTRICTED_CONFIG,
    'no-restricted-modules': RESTRICTED_CONFIG,
  },
};
