#! /usr/bin/env node

// @flow strict-local
'use strict';

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

require('./src/cli').createProgram().parse();
