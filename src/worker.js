require('v8-compile-cache');
const Parser = require('./Parser');

let parser;
function init(options) {
  console.log(`INIT: ${process.pid}`);
  Object.assign(process.env, options.env || {});
  parser = new Parser(options || {});
}

module.exports = async function(path, pkg, options) {
  // console.log(`RUNNING: ${process.pid}`);
  if (!parser) {
    init(options);
  }
  // console.log('Extensions: ', Object.keys(options.extensions).length);
  try {
    var asset = parser.getAsset(path, pkg, options);
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
