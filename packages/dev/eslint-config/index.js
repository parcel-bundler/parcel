module.exports = {
  extends: ['eslint:recommended', 'plugin:flowtype/recommended'],
  parser: 'babel-eslint',
  plugins: ['flowtype'],
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
  }
};
