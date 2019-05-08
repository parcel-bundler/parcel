const RESTRICTED_CONFIG = [
  'error',
  {
    patterns: ['@parcel/*/*', '!@parcel/integration-tests/*']
  }
];

module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:flowtype/recommended',
    'plugin:react/recommended',
    'prettier',
    'prettier/flowtype',
    'prettier/react'
  ],
  parser: 'babel-eslint',
  plugins: ['@parcel', 'flowtype', 'import', 'react'],
  parserOptions: {
    ecmaVersion: 2018,
    ecmaFeatures: {
      jsx: true
    },
    sourceType: 'module'
  },
  env: {
    node: true,
    es6: true
  },
  globals: {
    parcelRequire: true,
    define: true
  },
  // https://eslint.org/docs/user-guide/configuring#configuration-based-on-glob-patterns
  overrides: [
    {
      files: ['**/test/**', '*.test.js', 'packages/core/integration-tests/**'],
      env: {
        mocha: true
      },
      rules: {
        'import/no-extraneous-dependencies': 'off'
      }
    }
  ],
  rules: {
    '@parcel/no-self-package-imports': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-extraneous-dependencies': 'error',
    'import/no-self-import': 'error',
    'no-return-await': 'error',
    'no-restricted-imports': RESTRICTED_CONFIG,
    'no-restricted-modules': RESTRICTED_CONFIG
  },
  settings: {
    flowtype: {
      onlyFilesWithFlowAnnotation: true
    },
    react: {
      version: 'detect'
    }
  }
};
