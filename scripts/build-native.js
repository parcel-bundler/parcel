/* eslint-disable no-console */
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const {spawn} = require('child_process');

let release = process.argv.includes('--release');

async function build() {
  let packages = glob.sync('packages/*/*')
  for (let pkg of packages) {
    try {
      let pkgJSON = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json')));
      if (!pkgJSON.napi) continue;
    } catch (err) {
      continue;
    }

    console.log(`Building ${pkg}...`);
    await new Promise((resolve, reject) => {
      let args = [release ? 'build-release' : 'build'];
      if (process.env.RUST_TARGET) {
        args.push('--target', process.env.RUST_TARGET);
      }

      let yarn = spawn('yarn', args, {
        stdio: 'inherit',
        cwd: pkg,
        shell: true,
      });

      yarn.on('error', reject);
      yarn.on('close', resolve);
    });
  }
}

build();
