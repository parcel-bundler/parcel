#!/usr/bin/env node

'use strict';

if (process.env.PARCEL_BUILD_ENV !== 'production') {
  require('@parcel/babel-register');
  require('./src/cli');
} else {
  require('./lib/cli');
}
