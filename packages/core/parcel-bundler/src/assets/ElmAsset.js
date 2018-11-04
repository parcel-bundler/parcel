const Asset = require('../Asset');
const commandExists = require('command-exists');
const localRequire = require('../utils/localRequire');
const {minify} = require('elm-minify');
const path = require('path');
const spawn = require('cross-spawn');

class ElmAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
    this.hmrPageReload = true;
  }

  async parse() {
    let options = {
      cwd: path.dirname(this.name)
    };

    // If elm is not installed globally, install it locally.
    try {
      await commandExists('elm');
    } catch (err) {
      await localRequire('elm', this.name);
      options.pathToElm = path.join(
        path.dirname(require.resolve('elm')),
        'bin',
        'elm'
      );
    }

    this.elm = await localRequire('node-elm-compiler', this.name);

    // Ensure that an elm.json file exists, and initialize one if not.
    let elmConfig = await this.getConfig(['elm.json'], {load: false});
    if (!elmConfig) {
      await this.createElmConfig(options);

      // Ensure we are watching elm.json for changes
      await this.getConfig(['elm.json'], {load: false});
    }

    if (this.options.minify) {
      options.optimize = true;
    }

    let compiled = await this.elm.compileToString(this.name, options);
    this.contents = compiled.toString();
  }

  async collectDependencies() {
    let dependencies = await this.elm.findAllDependencies(this.name);
    for (let dependency of dependencies) {
      this.addDependency(dependency, {includedInParent: true});
    }
  }

  async createElmConfig(options) {
    let cp = spawn(options.pathToElm || 'elm', ['init']);
    cp.stdin.write('y\n');

    return new Promise((resolve, reject) => {
      cp.on('error', reject);
      cp.on('close', function(code) {
        if (code !== 0) {
          return reject(new Error('elm init failed.'));
        }

        return resolve();
      });
    });
  }

  async generate() {
    let output = this.contents;

    if (this.options.minify) {
      output = pack(output);
    }

    return {
      [this.type]: output
    };

    function pack(source) {

      let result = minify(source);

      if (result.error) {
        throw result.error;
      }

      return result.code;
    }
  }
}

module.exports = ElmAsset;
