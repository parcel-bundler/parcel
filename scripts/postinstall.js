/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

if (shouldBuildNative()) {
  require('./build-native');
}

function shouldBuildNative() {
  try {
    fs.statSync(path.join(__dirname, '..', 'packages/native-packages'));
  } catch (e) {
    console.log('Could not find linked native packages to build. Skipping...');
    return false;
  }
  return true;
}
