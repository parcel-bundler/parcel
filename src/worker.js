require('v8-compile-cache');
const Pipeline = require('./Pipeline');

let pipeline;

exports.init = function(options, callback) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {});
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
  callback();
};

exports.run = async function(path, pkg, options, isWarmUp, callback) {
  try {
    options.isWarmUp = isWarmUp;
    var result = await pipeline.process(path, pkg, options);

    callback(null, result);
  } catch (err) {
    let returned = err;
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
