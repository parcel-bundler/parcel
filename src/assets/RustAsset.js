const path = require('path');
const {exec} = require('child-process-promise');

const urlJoin = require('../utils/urlJoin');
const md5 = require('../utils/md5');
const fs = require('../utils/fs');
const JSAsset = require('./JSAsset');

const rustTarget = `wasm32-unknown-unknown`;

class RustAsset extends JSAsset {
  async getRustDeps(dir, base, name) {
    const depsCmd = `rustc ${base} --emit=dep-info`;
    // TODO: this will generate a .d file, we need to figure out what to do with this kind of temp files
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

  collectDependencies() {
    for (let dep of this.rustDeps) {
      console.log(dep);
      console.log(dep);
      this.addDependency(dep, {includedInParent: true});
    }
  }

  async parse() {
    const release = process.env.NODE_ENV === 'production';
    const {dir, base, name} = path.parse(this.name);
    const generatedName = md5(this.name);
    const wasmPath = path.join(this.options.outDir, generatedName + '.wasm');
    const wasmUrl = urlJoin(this.options.publicURL, generatedName + '.wasm');

    const compileCmd = `rustc +nightly --target ${rustTarget} -O --crate-type=cdylib ${base} -o ${wasmPath} ${
      release ? ' --release' : ''
    }`;

    await exec(compileCmd, {cwd: dir});

    this.rustDeps = await this.getRustDeps(dir, base, name);

    const urlToWasm = JSON.stringify(wasmUrl);

    this.contents = `module.exports=${urlToWasm};`;

    return await super.parse(this.contents);
  }
}

module.exports = RustAsset;
