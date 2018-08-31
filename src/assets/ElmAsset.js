const process = require('process');
const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const {minify} = require('terser');

class ElmAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
    this.forceReload = true;
  }

  async collectDependencies() {
    const {findAllDependencies} = await localRequire(
      'find-elm-dependencies',
      this.name
    );
    const dependencies = await findAllDependencies(this.name);

    dependencies.forEach(dependency => {
      this.addDependency(dependency, {includedInParent: true});
    });
  }

  async parse() {
    const elm = await localRequire('node-elm-compiler', this.name);

    const options = {
      cwd: process.cwd()
    };

    if (process.env.NODE_ENV === 'test') {
      options.cwd = this.options.rootDir;
    }

    if (this.options.minify) {
      options.optimize = true;
    }

    const compiled = await elm.compileToString(this.name, options);
    this.contents = compiled.toString();
  }

  async generate() {
    let output = this.contents;

    if (this.options.minify) {
      output = pack(output);
    }

    return {
      [this.type]: output
    };

    // Recommended minification
    // Based on:
    // - http://elm-lang.org/0.19.0/optimize
    function pack(source) {
      const options = {
        compress: {
          keep_fargs: false,
          pure_funcs: [
            'F2',
            'F3',
            'F4',
            'F5',
            'F6',
            'F7',
            'F8',
            'F9',
            'A2',
            'A3',
            'A4',
            'A5',
            'A6',
            'A7',
            'A8',
            'A9'
          ],
          pure_getters: true,
          unsafe: true,
          unsafe_comps: true
        },
        mangle: true,
        rename: false
      };

      const result = minify(source, options);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      return result.code;
    }
  }
}

module.exports = ElmAsset;
