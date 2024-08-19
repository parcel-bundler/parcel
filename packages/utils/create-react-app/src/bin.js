#!/usr/bin/env node

'use strict';

if (process.env.ATLASPACK_BUILD_ENV !== 'production') {
  require('@atlaspack/babel-register');
}

require('v8-compile-cache');
require('./cli');
