const fs = require('./utils/fs');
const Parser = require('./Parser');
const babel = require('./transforms/babel');

process.on('unhandledRejection', console.error)

let parser;

function emit(event, ...args) {
  process.send({event, args});
}

module.exports = async function (path, pkg, options, callback) {
  if (!parser) {
    parser = new Parser(options || {});
  }

  let asset = parser.getAsset(path, pkg, options);
  await asset.getDependencies();

  await babel(asset);

  asset.contents = Array.from(asset.globals.values()).join('\n') + '\n' + asset.contents;

  callback(null, {
    deps: Array.from(asset.dependencies),
    contents: asset.contents
  });
};
