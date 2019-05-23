// @flow strict-local

import {register} from '@parcel/core';

// Support both commonjs and ES6 modules
exports = module.exports = register;
exports.default = register;
exports.__esModule = true;
