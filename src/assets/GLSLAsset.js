const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class GLSLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  async parse() {
    const glslify = await localRequire('glslify', this.name);
    const basedir = this.name.slice(0, this.name.lastIndexOf('/') + 1);

    const glsl = glslify(this.contents, {basedir});

    return new GLSLAst(glsl, {basedir});
  }

  async collectDependencies() {
    const glslifyDeps = require('glslify-deps');
    const depper = glslifyDeps({cwd: this.ast.basedir});

    return new Promise(resolve => {
      depper.add(this.name, (err, deps) => {
        if (deps.length > 1) {
          this.addDependency(deps[1].file, {includedInParent: true});
          for (let dep of deps.slice(2)) {
            this.addDependency(dep.file, {includedInParent: false});
          }
        }

        resolve();
      });
    });
  }

  async generate() {
    return {
      js: `module.exports=${JSON.stringify(this.ast.glsl)};`
    };
  }
}

class GLSLAst {
  constructor(glsl, opts) {
    this.glsl = glsl;
    this.basedir = opts.basedir;
  }
}

module.exports = GLSLAsset;
