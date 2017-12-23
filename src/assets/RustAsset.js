const url = require('url');
const path = require('path');
const toml = require('toml');
const {exec} = require('child-process-promise');

const md5 = require('../utils/md5');
const fs = require('../utils/fs');
const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

const rustTarget = `wasm32-unknown-unknown`;

class RustAsset extends JSAsset {
  collectDependencies() {
    // Do nothing. Dependencies are collected by cargo :).
  }

  async parse() {
    const release = process.env.NODE_ENV === 'production';
    const {dir, ext, name, base} = path.parse(this.name);
    const wasmPath = path.join(
      this.options.publicURL,
      md5(this.name) + '.wasm'
    );
    const cmd = `rustc +nightly --target ${rustTarget} -O --crate-type=cdylib ${base} -o .${wasmPath} ${
      release ? ' --release' : ''
    }`;

    await exec(cmd, {cwd: dir});

    const pathToWasm = JSON.stringify(wasmPath);

    this.contents = `module.exports=${pathToWasm};`;

    return await super.parse(this.contents);
  }
}

module.exports = RustAsset;
