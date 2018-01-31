require('v8-compile-cache');
const Parser = require('./Parser');

let parser;

exports.init = function(options, callback) {
  parser = new Parser(options || {});
  Object.assign(process.env, options.env || {});
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
  callback();
};

exports.run = async function(path, pkg, options, isWarmUp, callback) {
  try {
    options.isWarmUp = isWarmUp;
    var asset = parser.getAsset(path, pkg, options);
    await asset.process();

    callback(null, {
      dependencies: Array.from(asset.dependencies.values()),
      generated: asset.generated,
      hash: asset.hash,
      cacheData: asset.cacheData
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

process.on('unhandledRejection', function(err) {
  // ERR_IPC_CHANNEL_CLOSED happens when the worker is killed before it finishes processing
  if (err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
    console.error('Unhandled promise rejection:', err.stack);
  }
});
