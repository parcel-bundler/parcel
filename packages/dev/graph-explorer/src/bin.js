#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

if (
  process.env.PARCEL_BUILD_ENV !== 'production' ||
  process.env.PARCEL_SELF_BUILD
) {
  require('@parcel/babel-register');
}

require('./cli');
