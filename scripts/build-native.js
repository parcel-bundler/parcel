/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

async function build() {
  let dir = path.join(__dirname, '..', 'native-packages');
  let nativePackages = fs.readdirSync(dir);
  for (let pkg of nativePackages) {
    if (pkg.startsWith('.')) continue;

    console.log(`Building ${pkg}...`);
    await new Promise((resolve, reject) => {
      let process = spawn('yarn', ['build-release'], {
        stdio: 'inherit',
        cwd: path.join(dir, pkg)
      });

      process.on('error', reject);
      process.on('close', resolve);
    });
  }
}

build();
