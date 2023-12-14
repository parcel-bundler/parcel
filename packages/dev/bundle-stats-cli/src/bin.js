#! /usr/bin/env node

'use strict';

if (
  process.env.PARCEL_BUILD_ENV !== 'production' ||
  process.env.PARCEL_SELF_BUILD
) {
  require('@parcel/babel-register');
}

const cli = require('./cli');

cli.command.parse();
