const getGlobals = require('./index.js');

output = {
  file: __filename,
  other: getGlobals().file
};
