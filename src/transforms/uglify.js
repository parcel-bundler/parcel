const {minify} = require('uglify-es');
const config = require('../utils/config');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  // Convert AST into JS
  let code = asset.generate().js;

  let customConfig = await config.load(asset.name, ['.uglifyrc']);
  let options = {
    warnings: true,
    mangle: {
      toplevel: true
    },
    compress: {
      drop_console: true
    }
  };

  if (customConfig) {
    options = Object.assign(options, customConfig);
  }

  let result = minify(code, options);
  if (result.error) {
    throw result.error;
  }

  // Log all warnings
  if (result.warnings) {
    result.warnings.forEach(warning => {
      // TODO: warn this using the logger
      console.log(warning);
    });
  }

  // babel-generator did our code generation for us, so remove the old AST
  asset.ast = null;
  asset.outputCode = result.code;
  asset.isAstDirty = false;
};
