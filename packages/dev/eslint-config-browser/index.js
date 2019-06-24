module.exports = {
  extends: '@parcel/eslint-config',
  parser: 'espree',
  parserOptions: {
    ecmaVersion: 5
  },
  env: {
    browser: true
  },
  rules: {
    'no-global-assign': 1,
    'no-unused-vars': 0,
    'no-console': 0
  }
};
