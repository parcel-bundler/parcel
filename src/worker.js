require('v8-compile-cache');
const Parser = require('./Parser');

let parser;

exports.init = function(options, callback) {
  parser = new Parser(options || {});
  callback();
};

exports.run = async function(path, pkg, options, callback) {
  try {
    var asset = parser.getAsset(path, pkg, options);
    await asset.process();

    callback(null, {
      dependencies: Array.from(asset.dependencies.values()),
      generated: asset.generated,
      hash: asset.hash
    });
  } catch (err) {
    let returned = err;

    if (asset) {
      returned = asset.generateErrorMessage(returned);
    }

    returned.fileName = path;
    callback(returned);
  }
};
