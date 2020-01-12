const path = require('path');
const commandExists = require('command-exists');
const childProcess = require('child_process');
const {promisify} = require('@parcel/utils');
const exec = promisify(childProcess.execFile);
const toml = require('@iarna/toml');
const fs = require('@parcel/fs');
const Asset = require('../Asset');
const config = require('../utils/config');
const pipeSpawn = require('../utils/pipeSpawn');
const md5 = require('../utils/md5');

const RUST_TARGET = 'wasm32-unknown-unknown';
const MAIN_FILES = ['src/lib.rs', 'src/main.rs'];

// Track installation status so we don't need to check more than once
let rustInstalled = false;

class RustAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'wasm';
  }

  process() {
    // We don't want to process this asset if the worker is in a warm up phase
    // since the asset will also be processed by the main process, which
    // may cause errors since rust writes to the filesystem.
    if (this.options.isWarmUp) {
      return;
    }

    return super.process();
  }

  async parse() {
    // Install rust toolchain and target if needed
    await this.installRust();

    // See if there is a Cargo config in the project
    let cargoConfig = await this.getConfig(['Cargo.toml']);
    let cargoDir;
    let isMainFile = false;

    if (cargoConfig) {
      const mainFiles = MAIN_FILES.slice();
      if (cargoConfig.lib && cargoConfig.lib.path) {
        mainFiles.push(cargoConfig.lib.path);
      }

      cargoDir = path.dirname(await config.resolve(this.name, ['Cargo.toml']));
      isMainFile = mainFiles.some(
        file => path.join(cargoDir, file) === this.name
      );
    }

    // If this is the main file of a Cargo build, use the cargo command to compile.
    // Otherwise, use rustc directly.
    if (isMainFile) {
      await this.cargoBuild(cargoConfig, cargoDir);
    } else {
      await this.rustcBuild();
    }
  }

  async installRust() {
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
    [stdout] = await exec('rustup', [
      'target',
      'list',
      '--toolchain',
      'nightly'
    ]);
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

  async cargoBuild(cargoConfig, cargoDir) {
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
        toml.stringify(cargoConfig)
      );
    }

    // Run cargo
    let args = ['+nightly', 'build', '--target', RUST_TARGET, '--release'];
    await exec('cargo', args, {cwd: cargoDir});

    // Get output file paths
    let [stdout] = await exec('cargo', ['metadata', '--format-version', '1'], {
      cwd: cargoDir
    });
    const cargoMetadata = JSON.parse(stdout);
    const cargoTargetDir = cargoMetadata.target_directory;
    let outDir = path.join(cargoTargetDir, RUST_TARGET, 'release');

    // Rust converts '-' to '_' when outputting files.
    let rustName = cargoConfig.package.name.replace(/-/g, '_');
    this.wasmPath = path.join(outDir, rustName + '.wasm');
    this.depsPath = path.join(outDir, rustName + '.d');
  }

  async rustcBuild() {
    // Get output filename
    await fs.mkdirp(this.options.cacheDir);
    let name = md5(this.name);
    this.wasmPath = path.join(this.options.cacheDir, name + '.wasm');

    // Run rustc to compile the code
    const args = [
      '+nightly',
      '--target',
      RUST_TARGET,
      '-O',
      '--crate-type=cdylib',
      this.name,
      '-o',
      this.wasmPath
    ];
    const minifyArgs = this.options.minify ? ['-Clink-arg=-s'] : [];

    await exec('rustc', [...args, ...minifyArgs]);

    // Run again to collect dependencies
    this.depsPath = path.join(this.options.cacheDir, name + '.d');
    await exec('rustc', [this.name, '--emit=dep-info', '-o', this.depsPath]);
  }

  async collectDependencies() {
    // Read deps file
    let contents = await fs.readFile(this.depsPath, 'utf8');
    let dir = path.dirname(this.name);

    let deps = contents
      .split('\n')
      .filter(Boolean)
      .slice(1);

    for (let dep of deps) {
      dep = path.resolve(dir, dep.slice(0, dep.indexOf(': ')));
      if (dep !== this.name) {
        this.addDependency(dep, {includedInParent: true});
      }
    }
  }

  async generate() {
    return {
      wasm: {
        path: this.wasmPath, // pass output path to RawPackager
        mtime: Date.now() // force re-bundling since otherwise the hash would never change
      }
    };
  }
}

module.exports = RustAsset;
