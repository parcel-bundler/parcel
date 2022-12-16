#! /usr/bin/env node

// @flow strict-local
'use strict';

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

let program = require('./src/cli').createProgram();

(async function main() {
  try {
    await program.parseAsync();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
