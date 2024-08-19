module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:flowtype/recommended',
    'plugin:monorepo/recommended',
    'plugin:react/recommended',
    'prettier',
  ],
  parser: '@babel/eslint-parser',
  plugins: ['@atlaspack', 'flowtype', 'import', 'monorepo', 'react', 'mocha'],
  parserOptions: {
    ecmaVersion: 2018,
    ecmaFeatures: {
      jsx: true,
    },
    sourceType: 'module',
  },
  env: {
    es2020: true,
    node: true,
  },
  globals: {
    atlaspackRequire: true,
    define: true,
    SharedArrayBuffer: true,
  },
  // https://eslint.org/docs/user-guide/configuring#configuration-based-on-glob-patterns
  overrides: [
    {
      files: ['**/test/**', '*.test.js', 'packages/core/integration-tests/**'],
      env: {
        mocha: true,
      },
      rules: {
        'import/no-extraneous-dependencies': 'off',
        'monorepo/no-internal-import': 'off',
        'monorepo/no-relative-import': 'off',
        'mocha/no-exclusive-tests': 'error',
      },
    },
  ],
  rules: {
    '@atlaspack/no-self-package-imports': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-extraneous-dependencies': 'error',
    'import/no-self-import': 'error',
    'no-prototype-builtins': 'off',
    'no-console': 'error',
    'no-return-await': 'error',
    'require-atomic-updates': 'off',
    'require-await': 'error',
  },
  settings: {
    flowtype: {
      onlyFilesWithFlowAnnotation: true,
    },
    react: {
      version: 'detect',
    },
  },
};
