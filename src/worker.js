require('v8-compile-cache');
const Parser = require('./Parser');

let self = {};

async function init(options) {
  console.log(`INIT: ${process.pid}`);
  self.parser = new Parser(options || {});
  Object.assign(process.env, options.env || {});
}

module.exports = async function(path, pkg, options, parserOptions) {
  try {
    if (!self.parser) {
      init(parserOptions);
    }
    var asset = self.parser.getAsset(path, pkg, options);
    await asset.process();

    return {
      dependencies: Array.from(asset.dependencies.values()),
      generated: asset.generated,
      hash: asset.hash
    };
  } catch (err) {
    let returned = err;

    if (asset) {
      returned = asset.generateErrorMessage(returned);
    }

    returned.fileName = path;
    throw returned;
  }
};
