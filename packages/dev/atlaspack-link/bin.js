#! /usr/bin/env node

// @flow strict-local
/* eslint-disable no-console */

'use strict';

// $FlowFixMe[untyped-import]
require('@atlaspack/babel-register');

let program = require('./src/cli').createProgram();

(async function main() {
  try {
    await program.parseAsync();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
