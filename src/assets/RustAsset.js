const path = require('path');
const commandExists = require('command-exists');
const {exec} = require('child-process-promise');

const fs = require('../utils/fs');
const JSAsset = require('./JSAsset');

const rustTarget = `wasm32-unknown-unknown`;

class RustAsset extends JSAsset {
  async getRustDeps(dir, base, name) {
    const depsCmd = `rustc ${base} --emit=dep-info`;
    await exec(depsCmd, {cwd: dir});

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

  async rustcParse() {
    const {dir, base, name} = path.parse(this.name);
    const wasmPath = path.format({
      dir,
      name,
      ext: '.wasm'
    });
    const compileCmd = `rustc +nightly --target ${rustTarget} -O --crate-type=cdylib ${base} -o ${wasmPath}`;

    await exec(compileCmd, {cwd: dir});
    this.rustDeps = await this.getRustDeps(dir, base, name);

    for (const dep of this.rustDeps) {
      this.addDependency(dep, {includedInParent: true});
    }

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

    const wasmPath = await this.rustcParse();
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
