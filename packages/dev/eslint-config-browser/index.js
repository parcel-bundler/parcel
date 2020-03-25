module.exports = {
  extends: '@parcel/eslint-config',
  parser: 'babel-eslint',
  parserOptions: {
    ecmaVersion: 5,
  },
  env: {
    browser: true,
  },
  rules: {
    'no-console': 'off',
    'no-global-assign': 'warn',
    'no-unused-vars': 'off',
  },
};
