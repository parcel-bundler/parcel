module.exports = {
  extends: ['eslint:recommended', 'plugin:flowtype/recommended'],
  parser: 'babel-eslint',
  plugins: ['flowtype', 'import'],
  parserOptions: {
    ecmaVersion: 8,
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
      files: ['**/test/**/*.js', '*.test.js'],
      env: {
        mocha: true
      }
    }
  ],
  rules: {
    'flowtype/space-after-type-colon': 'off', // conflicts with prettier
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-extraneous-dependencies': 'error',
    'import/no-self-import': 'error',
    'no-return-await': 'error'
  },
  settings: {
    flowtype: {
      onlyFilesWithFlowAnnotation: true
    }
  }
};
