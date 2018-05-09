const path = require('path');

const PugAsset = {
  type: 'html',

  async parse(code, state) {
    const pug = await state.require('pug');
    const config =
      (await state.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};

    return pug.compile(code, {
      compileDebug: false,
      filename: state.name,
      basedir: path.dirname(state.name),
      pretty: !state.options.minify,
      templateName: path.basename(state.basename, path.extname(state.basename)),
      filters: config.filters,
      filterOptions: config.filterOptions,
      filterAliases: config.filterAliases
    });
  },

  collectDependencies(ast, state) {
    if (ast.dependencies) {
      for (let item of ast.dependencies) {
        state.addDependency(item, {
          includedInParent: true
        });
      }
    }
  },

  generate(ast) {
    return ast();
  }
};

module.exports = {
  Asset: {
    pug: PugAsset,
    jade: PugAsset
  }
};
