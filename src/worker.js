require('v8-compile-cache');
const Pipeline = require('./Pipeline');

let pipeline;

function init(options) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {});
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
}

async function run(path, isWarmUp) {
  try {
    return await pipeline.process(path, isWarmUp);
  } catch (e) {
    e.fileName = path;
    throw e;
  }
}

exports.init = init;
exports.run = run;
