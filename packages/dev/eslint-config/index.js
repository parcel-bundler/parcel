module.exports = {
  extends: ['eslint:recommended', 'plugin:flowtype/recommended'],
  parser: 'babel-eslint',
  plugins: ['flowtype', 'import'],
  parserOptions: {
    ecmaVersion: 8,
    ecmaFeatures: {
      jsx: true
    }
  },
  env: {
    node: true,
    es6: true
  },
  globals: {
    parcelRequire: true,
    define: true
  },
  rules: {
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-extraneous-dependencies': 'error',
    'import/no-self-import': 'error'
  }
};
