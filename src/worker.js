require('v8-compile-cache');
const fs = require('./utils/fs');
const Parser = require('./Parser');
const babel = require('./transforms/babel');

let parser;

function emit(event, ...args) {
  process.send({event, args});
}

exports.init = function (options, callback) {
  parser = new Parser(options || {});
  callback();
};

exports.run = async function (path, pkg, options, callback) {
  try {
    var asset = parser.getAsset(path, pkg, options);
    await asset.process();

    callback(null, {
      dependencies: Array.from(asset.dependencies.values()),
      generated: asset.generated,
      hash: asset.hash
    });
  } catch (err) {
    if (asset) {
      err = asset.generateErrorMessage(err);
    }

    err.fileName = path;
    callback(err);
  }
};
