require('v8-compile-cache');
const Pipeline = require('../Pipeline');

let pipeline;

exports.init = function(options) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {});
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
};

exports.run = async function(path, pkg, options, isWarmUp) {
  try {
    options.isWarmUp = isWarmUp;
    return await pipeline.process(path, pkg, options);
  } catch (e) {
    e.fileName = path;
    throw e;
  }
};
