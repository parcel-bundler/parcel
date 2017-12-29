const path = require('path');
const {exec} = require('child-process-promise');

const urlJoin = require('../utils/urlJoin');
const md5 = require('../utils/md5');
const JSAsset = require('./JSAsset');

const rustTarget = `wasm32-unknown-unknown`;

class RustAsset extends JSAsset {
  collectDependencies() {
    // Do nothing. Dependencies are collected by cargo :).
  }

  async parse() {
    const release = process.env.NODE_ENV === 'production';
    const {dir, base} = path.parse(this.name);
    const generatedName = md5(this.name);
    const wasmPath = path.join(this.options.outDir, generatedName + '.wasm');
    const wasmUrl = urlJoin(this.options.publicURL, generatedName + '.wasm');

    const cmd = `rustc +nightly --target ${rustTarget} -O --crate-type=cdylib ${base} -o ${wasmPath} ${
      release ? ' --release' : ''
    }`;

    await exec(cmd, {cwd: dir});

    const urlToWasm = JSON.stringify(wasmUrl);

    this.contents = `module.exports=${urlToWasm};`;

    return await super.parse(this.contents);
  }
}

module.exports = RustAsset;
