#! /usr/bin/env node

/* eslint-disable no-console */
// @flow strict-local
'use strict';

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

const cli = require('./src/cli');

cli.command.parse();
