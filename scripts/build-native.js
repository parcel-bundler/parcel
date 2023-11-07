/* eslint-disable no-console */
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const {spawn, execSync} = require('child_process');

let release = process.argv.includes('--release');
build();

async function build() {
  if (process.env.CI && process.platform === 'darwin') {
    setupMacBuild();
  }

  let packages = glob.sync('packages/*/*');
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

      yarn.on('close', code => (code === 0 ? resolve() : reject()));
    }).catch(() => process.exit(1));
  }
}

// This forces Clang/LLVM to be used as a C compiler instead of GCC.
// This is necessary for cross-compilation for Apple Silicon in GitHub Actions.
function setupMacBuild() {
  process.env.CC = execSync('xcrun -f clang', {encoding: 'utf8'}).trim();
  process.env.CXX = execSync('xcrun -f clang++', {encoding: 'utf8'}).trim();

  let sysRoot = execSync('xcrun --sdk macosx --show-sdk-path', {
    encoding: 'utf8',
  }).trim();
  process.env.CFLAGS = `-isysroot ${sysRoot} -isystem ${sysRoot}`;
  process.env.MACOSX_DEPLOYMENT_TARGET = '10.9';
}
