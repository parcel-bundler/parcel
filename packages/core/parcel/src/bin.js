#!/usr/bin/env node

'use strict';

if (process.env.PARCEL_BUILD_ENV !== 'production') {
  require('@parcel/babel-register');
}
console.log('hello from parcel dev');
// Not merged with babel-register conditional above
// to prevent merge conflicts
const {getSentry} = require('@atlassian/internal-parcel-utils');

// Initialize Sentry as early as possible
getSentry();

require('./cli');
