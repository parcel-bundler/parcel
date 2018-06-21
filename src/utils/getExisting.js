const fs = require('fs');
/**
 * Creates an object that contains both source and minified
 * source (using the source as a fallback).
 * e.g. builtins.min.js and builtins.js.
 */
module.exports = function(minified, source) {
  var sourceFile = fs.readFileSync(source, 'utf8').trim();
  return {
    source: sourceFile,
    minified: fs.existsSync(minified) ? fs
      .readFileSync(minified, 'utf8')
      .trim()
      .replace(/;$/, '') : sourceFile
  }
};
