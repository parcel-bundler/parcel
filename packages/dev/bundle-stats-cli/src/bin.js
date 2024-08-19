#! /usr/bin/env node

'use strict';

if (
  process.env.ATLASPACK_BUILD_ENV !== 'production' ||
  process.env.ATLASPACK_SELF_BUILD
) {
  require('@atlaspack/babel-register');
}

const cli = require('./cli');

cli.command.parse();
