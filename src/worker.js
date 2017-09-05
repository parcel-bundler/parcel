const fs = require('./utils/fs');
const Parser = require('./Parser');
const babel = require('./transforms/babel');

process.on('unhandledRejection', console.error)

let parser;

function emit(event, ...args) {
  process.send({event, args});
}

exports.init = function (options, callback) {
  parser = new Parser(options || {});
  callback();
};

exports.run = async function (path, pkg, options, callback) {
  let asset = parser.getAsset(path, pkg, options);
  await asset.process();

  callback(null, {
    dependencies: Array.from(asset.dependencies.values()),
    generated: asset.generated,
    hash: asset.hash
  });
};
