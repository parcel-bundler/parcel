const {minify} = require('uglify-es');

module.exports = async function(code) {
  let options = {
    warnings: true,
    mangle: {
      toplevel: true
    },
    compress: {
      drop_console: true
    }
  };

  let result = minify(code, options);

  if (result.error) throw result.error;

  // Log all warnings
  if (result.warnings) {
    result.warnings.forEach(warning => {
      // TODO: warn this using the logger
      console.log(warning);
    });
  }
  return result.code;
};
