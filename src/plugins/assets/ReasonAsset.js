const fs = require('../../utils/fs');

const ReasonAsset = {
  type: 'js',

  async parse(code, state) {
    const bsb = await state.require('bsb-js');

    // This runs BuckleScript - the Reason to JS compiler.
    // Other Asset types use `localRequire` but the `bsb-js` package already
    // does that internally. This should also take care of error handling in
    // the Reason compilation process.
    if (process.env.NODE_ENV !== 'test') {
      await bsb.runBuild();
    }

    // This is a simplified use-case for Reason - it only loads the recommended
    // BuckleScript configuration to simplify the file processing.
    const outputFile = state.name.replace(/\.(re|ml)$/, '.bs.js');

    return fs.readFile(outputFile);
  },

  generate(ast) {
    return {
      js: ast.toString()
    };
  }
};

module.exports = {
  Asset: {
    ml: ReasonAsset,
    re: ReasonAsset
  }
};
