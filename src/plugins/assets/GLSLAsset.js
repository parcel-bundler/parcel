const path = require('path');
const promisify = require('../../utils/promisify');
const Resolver = require('../../Resolver');

const GLSLAsset = {
  type: 'js',

  async parse(code, state) {
    const glslifyDeps = await state.require('glslify-deps');

    // Use the Parcel resolver rather than the default glslify one.
    // This adds support for parcel features like alises, and tilde paths.
    const resolver = new Resolver({
      extensions: ['.glsl', '.vert', '.frag'],
      rootDir: state.options.rootDir
    });

    // Parse and collect dependencies with glslify-deps
    let cwd = path.dirname(state.name);
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

    return await promisify(depper.inline.bind(depper))(state.contents, cwd);
  },

  collectDependencies(ast, state) {
    for (let dep of ast) {
      if (!dep.entry) {
        state.addDependency(dep.file, {includedInParent: true});
      }
    }
  },

  async generate(ast, state) {
    // Generate the bundled glsl file
    const glslifyBundle = await state.require('glslify-bundle');
    let glsl = glslifyBundle(ast);

    return {
      js: `module.exports=${JSON.stringify(glsl)};`
    };
  }
};

module.exports = {
  Asset: {
    glsl: GLSLAsset,
    vert: GLSLAsset,
    frag: GLSLAsset
  }
};
