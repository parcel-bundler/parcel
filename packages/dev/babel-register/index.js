const parcelBabelPreset = require('@parcel/babel-preset');
const path = require('path');

require('@babel/register')({
  ignore: [filepath => filepath.includes(path.sep + 'node_modules' + path.sep)],
  presets: [parcelBabelPreset]
});

// This adds the registration to the Node args, which are passed
// to child processes by Node when we fork to create workers.
process.execArgv.push('-r', '@parcel/babel-register');
