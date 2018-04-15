require('v8-compile-cache');
const Pipeline = require('./Pipeline');
const child = require('./workerfarm/child');
const WorkerFarm = require('./workerfarm/WorkerFarm');

let pipeline;

function init(options, isLocal = false) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {});
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
  if (isLocal) {
    process.env.WORKER_TYPE = 'parcel-worker';
  }
}

async function run(path, pkg, options, isWarmUp) {
  try {
    options.isWarmUp = isWarmUp;
    return await pipeline.process(path, pkg, options);
  } catch (e) {
    e.fileName = path;
    throw e;
  }
}

// request.location is a module path relative to src or lib
async function addCall(request, awaitResponse = true) {
  if (process.send && process.env.WORKER_TYPE === 'parcel-worker') {
    return child.addCall(request, awaitResponse);
  } else {
    return WorkerFarm.getShared().processRequest(request);
  }
}

exports.init = init;
exports.run = run;
exports.addCall = addCall;
