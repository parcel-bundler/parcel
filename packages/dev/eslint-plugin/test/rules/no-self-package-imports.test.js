'use strict';

const {RuleTester} = require('eslint');
const rule = require('../../src/rules/no-self-package-imports');

const message =
  'Do not require a module by package name within the same package.';

const filename = __filename;

new RuleTester({
  parser: require.resolve('@babel/eslint-parser'),
  parserOptions: {ecmaVersion: 2018, sourceType: 'module'},
}).run('no-self-package-imports', rule, {
  valid: [
    {code: "require('path');", filename},
    {code: "require('@atlaspack/logger');", filename},
    {code: "require.resolve('@atlaspack/logger');", filename},
    {code: "import logger from '@atlaspack/logger';", filename},
  ],
  invalid: [
    {
      code: "require('@atlaspack/eslint-plugin/lib/rules/no-self-package-imports');",
      errors: [{message}],
      filename,
      output: "require('../../lib/rules/no-self-package-imports');",
    },
    {
      code: "require('@atlaspack/eslint-plugin');",
      filename,
      errors: [{message}],
      output: "require('../../');",
    },
    {
      code: "require.resolve('@atlaspack/eslint-plugin/lib/rules/no-self-package-imports');",
      filename,
      errors: [{message}],
      output: "require.resolve('../../lib/rules/no-self-package-imports');",
    },
    {
      code: "import rule from '@atlaspack/eslint-plugin';",
      filename,
      errors: [{message}],
      output: "import rule from '../../';",
    },
    {
      code: "import rule from '@atlaspack/eslint-plugin/lib/rules/no-self-package-imports';",
      filename,
      errors: [{message}],
      output: "import rule from '../../lib/rules/no-self-package-imports';",
    },
  ],
});
