const path = require('path');
const commandExists = require('command-exists');
const {exec} = require('child-process-promise');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');

const fs = require('../utils/fs');
const JSAsset = require('./JSAsset');
const config = require('../utils/config');

const rustTarget = `wasm32-unknown-unknown`;

class RustAsset extends JSAsset {
  async generateRustDeps(dir, base) {
    const depsCmd = `rustc ${base} --emit=dep-info`;
    await exec(depsCmd, {cwd: dir});
  }
  async getRustDeps(dir, name) {
    const deps = await fs.readFile(
      path.format({
        dir,
        name,
        ext: '.d'
      }),
      this.encoding
    );

    return deps
      .split('\n')
      .filter(Boolean)
      .slice(1)
      .map(dep => path.join(dir, dep.replace(':', '')));
  }

  async getCargoPath() {
    return await config.resolve(
      this.name,
      ['Cargo.toml'],
      path.parse(this.name).root
    );
  }

  async getCargoDir() {
    return path.parse(await this.getCargoPath()).dir;
  }

  async cargoParse(cargoConfig, cargoDir) {
    const rustName = cargoConfig.package.name;
    const compileCmd = `cargo +nightly build --target wasm32-unknown-unknown --release`;
    if (!cargoConfig.lib) {
      cargoConfig.lib = {};
    }
    if (!Array.isArray(cargoConfig.lib['crate-type'])) {
      cargoConfig.lib['crate-type'] = [];
    }
    if (!cargoConfig.lib['crate-type'].includes('cdylib')) {
      cargoConfig.lib['crate-type'].push('cdylib');
      await fs.writeFile(
        await this.getCargoPath(),
        tomlify.toToml(cargoConfig)
      );
    }

    await exec(compileCmd, {cwd: cargoDir});

    const outDir = path.join(cargoDir, 'target', rustTarget, 'release');
    const wasmFile = path.join(outDir, rustName + '.wasm');

    this.rustDeps = await this.getRustDeps(outDir, rustName);

    return wasmFile;
  }

  async rustcParse() {
    const {dir, base, name} = path.parse(this.name);
    const wasmPath = path.format({
      dir,
      name,
      ext: '.wasm'
    });
    const compileCmd = `rustc +nightly --target ${rustTarget} -O --crate-type=cdylib ${base} -o ${wasmPath}`;

    await exec(compileCmd, {cwd: dir});
    await this.generateRustDeps(dir, base);
    this.rustDeps = await this.getRustDeps(dir, name);

    return wasmPath;
  }

  async parse() {
    const isProduction = process.env.NODE_ENV === 'production';
    try {
      await commandExists('rustc');
    } catch (e) {
      throw new Error(
        "Rust isn't install, you can visit https://www.rustup.rs/ for most info"
      );
    }
    const cargoDir = await this.getCargoDir();
    const mainFiles = ['src/lib.rs', 'src/main.rs'];

    const cargoConfig = await config.load(
      this.name,
      ['Cargo.toml'],
      undefined,
      toml.parse
    );

    if (cargoConfig && cargoConfig.lib && cargoConfig.lib.path) {
      mainFiles.push(cargoConfig.lib.path);
    }
    const mainFile = mainFiles.find(
      file => path.join(cargoDir, file) === this.name
    );

    const wasmPath = await (mainFile
      ? this.cargoParse(cargoConfig, cargoDir)
      : this.rustcParse());

    for (const dep of this.rustDeps) {
      this.addDependency(dep, {includedInParent: true});
    }
    if (isProduction) {
      try {
        await commandExists('wasm-gc');
      } catch (e) {
        await exec(
          'cargo install --git https://github.com/alexcrichton/wasm-gc'
        );
      }
      await exec('wasm-gc ${wasmPath} ${wasmPath}');
    }
    const nameModule = './' + path.relative(path.dirname(this.name), wasmPath);

    this.contents = `module.exports = require(${JSON.stringify(nameModule)})`;

    return await super.parse(this.contents);
  }
}

module.exports = RustAsset;
