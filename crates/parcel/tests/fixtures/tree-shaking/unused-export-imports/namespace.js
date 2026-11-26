import * as utils from './utils.js';

output = Object.keys(utils)
  .sort()
  .map(key => utils[key]());
