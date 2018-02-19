const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const path = require('path');

class GLSLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  async parse() {
    const glslify = await localRequire('glslify', this.name);

    const basedir = path.dirname(this.name);
    const glsl = glslify(this.contents, {basedir});

    return new GLSLAst(glsl, {basedir});
  }

  async collectDependencies() {
    const glslifyDeps = require('glslify-deps');
    const depper = glslifyDeps({cwd: this.ast.basedir});

    return new Promise(resolve => {
      depper.add(this.name, (err, assets) => {
        for (const asset of assets) {
          for (const dep of Object.keys(asset.deps)) {
            const fullPath = path.normalize(asset.file + '/../' + dep);
            this.addDependency(fullPath, {includedInParent: true});
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
