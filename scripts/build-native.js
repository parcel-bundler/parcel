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
      let args = ['build-release'];
      if (process.env.RUST_TARGET) {
        args.push('--target', process.env.RUST_TARGET);
      }

      let yarn = spawn('yarn', args, {
        stdio: 'inherit',
        cwd: path.join(dir, pkg),
        shell: true,
      });

      yarn.on('error', reject);
      yarn.on('close', resolve);
    });
  }
}

build();
