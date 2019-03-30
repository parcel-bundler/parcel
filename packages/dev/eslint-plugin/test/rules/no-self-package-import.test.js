'use strict';

const {RuleTester} = require('eslint');
const rule = require('../../lib/rules/no-self-package-import');

const message =
  'Do not require a module by package name within the same package.';

const filename = __filename;

new RuleTester({
  parser: 'babel-eslint',
  parserOptions: {ecmaVersion: 2018, sourceType: 'module'}
}).run('no-self-package-import', rule, {
  valid: [
    {code: "require('path');", filename},
    {code: "require('@parcel/logger');", filename},
    {code: "require.resolve('@parcel/logger');", filename},
    {code: "import logger from '@parcel/logger';", filename}
  ],
  invalid: [
    {
      code:
        "require('@parcel/eslint-plugin/lib/rules/no-self-package-import');",
      errors: [{message}],
      filename,
      output: "require('../../lib/rules/no-self-package-import');"
    },
    {
      code: "require('@parcel/eslint-plugin');",
      filename,
      errors: [{message}],
      output: "require('../../');"
    },
    {
      code:
        "require.resolve('@parcel/eslint-plugin/lib/rules/no-self-package-import');",
      filename,
      errors: [{message}],
      output: "require.resolve('../../lib/rules/no-self-package-import');"
    },
    {
      code: "import rule from '@parcel/eslint-plugin';",
      filename,
      errors: [{message}],
      output: "import rule from '../../';"
    },
    {
      code:
        "import rule from '@parcel/eslint-plugin/lib/rules/no-self-package-import';",
      filename,
      errors: [{message}],
      output: "import rule from '../../lib/rules/no-self-package-import';"
    }
  ]
});
