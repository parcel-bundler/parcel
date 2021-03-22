#!/usr/bin/env node

'use strict';

if (process.env.PARCEL_BUILD_ENV !== 'production') {
  require('@parcel/babel-register');
}

console.log('hi from parcel2');
require('./cli');
