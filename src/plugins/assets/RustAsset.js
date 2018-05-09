const path = require('path');
const commandExists = require('command-exists');
const childProcess = require('child_process');
const promisify = require('../../utils/promisify');
const exec = promisify(childProcess.execFile);
const tomlify = require('tomlify-j0.4');
const fs = require('../../utils/fs');
const config = require('../../utils/config');
const pipeSpawn = require('../../utils/pipeSpawn');
const md5 = require('../../utils/md5');

const RUST_TARGET = 'wasm32-unknown-unknown';
const MAIN_FILES = ['src/lib.rs', 'src/main.rs'];

const RustAsset = {
  type: 'wasm',

  async parse(code, state) {
    // We don't want to process this asset if the worker is in a warm up phase
    // since the asset will also be processed by the main process, which
    // may cause errors since rust writes to the filesystem.
    if (state.options.isWarmUp) {
      return 'ignore';
    }

    // Install rust toolchain and target if needed
    await installRust();

    // See if there is a Cargo config in the project
    let cargoConfig = await state.getConfig(['Cargo.toml']);
    let cargoDir;
    let isMainFile = false;

    if (cargoConfig) {
      const mainFiles = MAIN_FILES.slice();
      if (cargoConfig.lib && cargoConfig.lib.path) {
        mainFiles.push(cargoConfig.lib.path);
      }

      cargoDir = path.dirname(await config.resolve(state.name, ['Cargo.toml']));
      isMainFile = mainFiles.some(
        file => path.join(cargoDir, file) === state.name
      );
    }

    // If this is the main file of a Cargo build, use the cargo command to compile.
    // Otherwise, use rustc directly.
    if (isMainFile) {
      await cargoBuild(state, cargoConfig, cargoDir);
    } else {
      await rustcBuild(state);
    }

    // If this is a prod build, use wasm-gc to remove unused code
    if (state.options.minify) {
      await installWasmGC();
      await exec('wasm-gc', [state.wasmPath, state.wasmPath]);
    }
  },

  async collectDependencies(ast, state) {
    if (ast === 'ignore') {
      return;
    }

    // Read deps file
    let contents = await fs.readFile(state.depsPath, 'utf8');
    let dir = path.dirname(state.name);

    let deps = contents
      .split('\n')
      .filter(Boolean)
      .slice(1);

    for (let dep of deps) {
      dep = path.resolve(dir, dep.slice(0, dep.indexOf(':')));
      if (dep !== state.name) {
        state.addDependency(dep, {includedInParent: true});
      }
    }
  },

  async generate(ast, state) {
    if (ast === 'ignore') {
      return;
    }

    return {
      wasm: {
        path: state.wasmPath, // pass output path to RawPackager
        mtime: Date.now() // force re-bundling since otherwise the hash would never change
      }
    };
  }
};

async function cargoBuild(asset, cargoConfig, cargoDir) {
  // Ensure the cargo config has cdylib as the crate-type
  if (!cargoConfig.lib) {
    cargoConfig.lib = {};
  }

  if (!Array.isArray(cargoConfig.lib['crate-type'])) {
    cargoConfig.lib['crate-type'] = [];
  }

  if (!cargoConfig.lib['crate-type'].includes('cdylib')) {
    cargoConfig.lib['crate-type'].push('cdylib');
    await fs.writeFile(
      path.join(cargoDir, 'Cargo.toml'),
      tomlify.toToml(cargoConfig)
    );
  }

  // Run cargo
  let args = ['+nightly', 'build', '--target', RUST_TARGET, '--release'];
  await exec('cargo', args, {cwd: cargoDir});

  // Get output file paths
  let outDir = path.join(cargoDir, 'target', RUST_TARGET, 'release');

  // Rust converts '-' to '_' when outputting files.
  let rustName = cargoConfig.package.name.replace(/-/g, '_');
  asset.wasmPath = path.join(outDir, rustName + '.wasm');
  asset.depsPath = path.join(outDir, rustName + '.d');
}

async function rustcBuild(asset) {
  // Get output filename
  await fs.mkdirp(asset.options.cacheDir);
  let name = md5(asset.name);
  asset.wasmPath = path.join(asset.options.cacheDir, name + '.wasm');

  // Run rustc to compile the code
  const args = [
    '+nightly',
    '--target',
    RUST_TARGET,
    '-O',
    '--crate-type=cdylib',
    asset.name,
    '-o',
    asset.wasmPath
  ];
  await exec('rustc', args);

  // Run again to collect dependencies
  asset.depsPath = path.join(asset.options.cacheDir, name + '.d');
  await exec('rustc', [asset.name, '--emit=dep-info', '-o', asset.depsPath]);
}

// Track installation status so we don't need to check more than once
let rustInstalled = false;
let wasmGCInstalled = false;

async function installRust() {
  if (rustInstalled) {
    return;
  }

  // Check for rustup
  try {
    await commandExists('rustup');
  } catch (e) {
    throw new Error(
      "Rust isn't installed. Visit https://www.rustup.rs/ for more info"
    );
  }

  // Ensure nightly toolchain is installed
  let [stdout] = await exec('rustup', ['show']);
  if (!stdout.includes('nightly')) {
    await pipeSpawn('rustup', ['update']);
    await pipeSpawn('rustup', ['toolchain', 'install', 'nightly']);
  }

  // Ensure wasm target is installed
  [stdout] = await exec('rustup', ['target', 'list', '--toolchain', 'nightly']);
  if (!stdout.includes(RUST_TARGET + ' (installed)')) {
    await pipeSpawn('rustup', [
      'target',
      'add',
      RUST_TARGET,
      '--toolchain',
      'nightly'
    ]);
  }

  rustInstalled = true;
}

async function installWasmGC() {
  if (wasmGCInstalled) {
    return;
  }

  try {
    await commandExists('wasm-gc');
  } catch (e) {
    await pipeSpawn('cargo', [
      'install',
      '--git',
      'https://github.com/alexcrichton/wasm-gc'
    ]);
  }

  wasmGCInstalled = true;
}

module.exports = {
  Asset: {
    rs: RustAsset
  }
};
