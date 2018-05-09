const CoffeeScriptAsset = {
  type: 'js',

  async parse(code, state) {
    // require coffeescript, installed locally in the app
    let coffee = await state.require('coffeescript');

    // Transpile Module using CoffeeScript and parse result as ast format through babylon
    return coffee.compile(state.contents, {
      sourceMap: state.options.sourceMaps
    });
  },

  generate(ast, state) {
    let sourceMap;
    if (ast.sourceMap) {
      sourceMap = ast.sourceMap.generate();
      sourceMap.sources = [state.relativeName];
      sourceMap.sourcesContent = [state.contents];
    }

    return [
      {
        type: 'js',
        value: state.options.sourceMaps ? ast.js : ast,
        sourceMap
      }
    ];
  }
};

module.exports = {
  Asset: {
    coffee: CoffeeScriptAsset
  }
};
