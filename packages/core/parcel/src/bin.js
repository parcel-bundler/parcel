#!/usr/bin/env node

'use strict';

if (process.env.PARCEL_BUILD_ENV !== 'production') {
  require('@parcel/babel-register');
}

// Not merged with babel-register conditional above
// to prevent merge conflicts
if (process.env.PARCEL_BUILD_ENV === 'production') {
  const {getSentry} = require('@atlassian/internal-parcel-utils');

  // Initialize Sentry as early as possible
  getSentry();
}

require('./cli');
