/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

if (process.env.PARCEL_BUILD_ENV == 'production') {
  bundleBuild();
}

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

function bundleBuild() {
  const packagesCustomBuild = ['packages/optimizers/cssnano'];
  for (const p of packagesCustomBuild) {
    execSync('yarn build', {cwd: p, stdio: 'inherit'});
  }
}
