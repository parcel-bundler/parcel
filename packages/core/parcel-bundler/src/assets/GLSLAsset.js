const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const path = require('path');
const {promisify} = require('@parcel/utils');
const Resolver = require('../Resolver');

class GLSLAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async parse() {
    const glslifyDeps = await localRequire('glslify-deps', this.name);

    // Use the Parcel resolver rather than the default glslify one.
    // This adds support for parcel features like aliases, and tilde paths.
    const resolver = new Resolver({
      extensions: ['.glsl', '.vert', '.frag'],
      rootDir: this.options.rootDir
    });

    // Parse and collect dependencies with glslify-deps
    let cwd = path.dirname(this.name);
    let depper = glslifyDeps({
      cwd,
      resolve: async (target, opts, next) => {
        try {
          let res = await resolver.resolve(
            target,
            path.join(opts.basedir, 'index')
          );
          next(null, res.path);
        } catch (err) {
          next(err);
        }
      }
    });

    return await promisify(depper.inline.bind(depper))(this.contents, cwd);
  }

  collectDependencies() {
    for (let dep of this.ast) {
      if (!dep.entry) {
        this.addDependency(dep.file, {includedInParent: true});
      }
    }
  }

  async generate() {
    // Generate the bundled glsl file
    const glslifyBundle = await localRequire('glslify-bundle', this.name);
    let glsl = glslifyBundle(this.ast);

    return `module.exports=${JSON.stringify(glsl)};`;
  }
}

module.exports = GLSLAsset;
