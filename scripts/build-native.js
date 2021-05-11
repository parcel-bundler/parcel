/* eslint-disable no-console */
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const {spawn, execSync} = require('child_process');

let release = process.argv.includes('--release');
build();

async function build() {
  if (process.platform === 'darwin') {
    await setupMacBuild();
  }

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

function setupMacBuild() {
  let xcodeDir = execSync('xcode-select -p | head -1', {encoding: 'utf8'}).trim();
  let sysRoot = execSync('xcrun --sdk macosx --show-sdk-path', {encoding: 'utf8'}).trim();
  console.log(xcodeDir, sysRoot);
  process.env.CC = `${xcodeDir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang`;
  process.env.CXX = `${xcodeDir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++`;
  process.env.CFLAGS = `-isysroot ${sysRoot} -isystem ${sysRoot}`;
}
