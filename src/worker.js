require('v8-compile-cache');
const Parser = require('./Parser');

let parser;
function init(options) {
  Object.assign(process.env, options.env || {});
  parser = new Parser(options || {});
}

async function run(path, pkg, options) {
  init(options);
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
}

function isReady() {
  return 'ready';
}

exports.init = init;
exports.run = run;
exports.isReady = isReady;
