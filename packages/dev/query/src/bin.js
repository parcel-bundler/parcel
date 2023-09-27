#!/usr/bin/env node

'use strict';

if (
  process.env.PARCEL_BUILD_ENV !== 'production' ||
  process.env.PARCEL_SELF_BUILD
) {
  require('@parcel/babel-register');
}

const run = require('./cli').run;
require('v8-compile-cache');

run(process.argv.slice(2));
