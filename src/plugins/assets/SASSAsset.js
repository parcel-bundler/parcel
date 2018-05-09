const path = require('path');
const os = require('os');
const Resolver = require('../../Resolver');
const promisify = require('../../utils/promisify');
const syncPromise = require('../../utils/syncPromise');

const SASSAsset = {
  type: 'css',

  async parse(code, state) {
    // node-sass should be installed locally in the module that's being required
    let sass = await state.require('node-sass');
    let render = promisify(sass.render.bind(sass));
    let resolver = new Resolver({
      extensions: ['.scss', '.sass'],
      rootDir: state.options.rootDir
    });

    let opts =
      (await state.getConfig(['.sassrc', '.sassrc.js'], {
        packageKey: 'sass'
      })) || {};
    opts.includePaths = (opts.includePaths || []).concat(
      path.dirname(state.name)
    );
    opts.data = opts.data ? opts.data + os.EOL + code : code;
    opts.indentedSyntax =
      typeof opts.indentedSyntax === 'boolean'
        ? opts.indentedSyntax
        : path.extname(state.name).toLowerCase() === '.sass';

    opts.functions = Object.assign({}, opts.functions, {
      url: node => {
        let filename = state.addURLDependency(node.getValue());
        return new sass.types.String(`url(${JSON.stringify(filename)})`);
      }
    });

    opts.importer = (url, prev, done) => {
      let resolved;
      try {
        resolved = syncPromise(
          resolver.resolve(url, prev === 'stdin' ? state.name : prev)
        ).path;
      } catch (e) {
        resolved = url;
      }
      return done({
        file: resolved
      });
    };

    return await render(opts);
  },

  collectDependencies(ast, state) {
    for (let dep of ast.stats.includedFiles) {
      state.addDependency(dep, {includedInParent: true});
    }
  },

  generate(ast) {
    return [
      {
        type: 'css',
        value: ast ? ast.css.toString() : '',
        hasDependencies: false
      }
    ];
  }
};

module.exports = {
  Asset: {
    sass: SASSAsset,
    scss: SASSAsset
  }
};
