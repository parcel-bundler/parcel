const url = require('url');
const path = require('path');
const toml = require('toml');
const {exec} = require('child-process-promise');

const fs = require('../utils/fs');
const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

const rustTarget = `wasm32-unknown-emscripten`;

class RustAsset extends JSAsset {
  collectDependencies() {
    // Do nothing. Dependencies are collected by cargo :).
  }

  async parse(code) {
    const {name, encoding, options} = this;
    const release = process.env.NODE_ENV === 'production';
    const cmd = `wargo build ${release ? ' --release' : ''}`;

    const projectDir = path.join(path.dirname(name), '..');
    const cargoFile = await fs.readFile(
      path.join(projectDir, 'Cargo.toml'),
      encoding
    );
    const packageName = toml.parse(cargoFile.toString()).package.name;

    const outDir = path.join(
      projectDir,
      'target',
      rustTarget,
      release ? 'release' : 'debug'
    );
    const depsDir = path.join(outDir, 'deps');

    const outFile = path.join(outDir, `${packageName}.js`);

    await exec(cmd, {cwd: projectDir});

    const out = await fs.readFile(outFile, encoding);
    const deps = await fs.readdir(path.join(outDir, 'deps'));

    const wasmFile = deps.find(f => /\.wasm$/.test(f));

    if (!wasmFile) {
      throw new Error('No wasm file found', null);
    }

    const generatedName = this.addURLDependency(path.join(depsDir, wasmFile));

    const wasmBinaryFile = url.resolve(
      path.join(options.publicURL, generatedName),
      ''
    );

    const Module = {
      // Path in the built project to the wasm file
      wasmBinaryFile,
      // Indicates that we are NOT running in node, despite 'require' being defined
      ENVIRONMENT: 'WEB'
    };

    if (options.from === 'html') {
      // if the rust file is called from an html, it's going to be called right away
      // when the wasm file is loaded as a standalone executable
      this.contents = `((Module) => {
        ${out}
      })(${JSON.stringify(Module)})`;
    } else {
      this.contents = `module.exports = (function(existingModule){
        return {
          // Returns a promise that resolves when the wasm runtime is initialized and ready for use
          initialize: function(userDefinedModule) {
            return new Promise((resolve, reject) => {
              if (!userDefinedModule) {
                userDefinedModule = {}
              }
              var Module = Object.assign({}, userDefinedModule, existingModule);
              Module['onRuntimeInitialized'] = () => resolve(Module);
              \n${out}\n
            });
          }
        }
      })(${JSON.stringify(Module)})`;
    }

    return await super.parse(this.contents);
  }
}

module.exports = RustAsset;
