const {minify} = require('terser');
const serialize = require('serialize-to-js');

function serializeObject(obj, shouldMinify = false) {
  let code = `module.exports = ${serialize(obj)};`;

  if (shouldMinify) {
    let minified = minify(code);
    if (minified.error) {
      throw minified.error;
    }

    code = minified.code;
  }

  return code;
}

module.exports = serializeObject;
