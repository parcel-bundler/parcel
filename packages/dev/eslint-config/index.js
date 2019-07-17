module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:flowtype/recommended',
    'plugin:monorepo/recommended',
    'plugin:react/recommended',
    'prettier',
    'prettier/flowtype',
    'prettier/react'
  ],
  parser: 'babel-eslint',
  plugins: ['@parcel', 'flowtype', 'import', 'monorepo', 'react'],
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
    define: true,
    SharedArrayBuffer: true
  },
  // https://eslint.org/docs/user-guide/configuring#configuration-based-on-glob-patterns
  overrides: [
    {
      files: ['**/test/**', '*.test.js', 'packages/core/integration-tests/**'],
      env: {
        mocha: true
      },
      rules: {
        'import/no-extraneous-dependencies': 'off',
        'monorepo/no-internal-import': 'off',
        'monorepo/no-relative-import': 'off'
      }
    }
  ],
  rules: {
    '@parcel/no-self-package-imports': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-extraneous-dependencies': 'error',
    'import/no-self-import': 'error',
    'no-return-await': 'error'
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
