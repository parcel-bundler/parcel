const fs = require('fs');
/**
 * Creates an object that contains both source and minified (using the source as a fallback).
 * e.g. builtins.min.js and builtins.js.
 */
module.exports = (minifiedPath, sourcePath) => {
  let source = fs.readFileSync(sourcePath, 'utf8').trim();
  return {
    source,
    minified: fs.existsSync(minifiedPath)
      ? fs
          .readFileSync(minifiedPath, 'utf8')
          .trim()
          .replace(/;$/, '')
      : source
  };
};
