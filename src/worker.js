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

exports.run = async function(path, id, pkg, options, isWarmUp, callback) {
  try {
    options.isWarmUp = isWarmUp;
    var result = await pipeline.process(path, id, pkg, options);

    callback(null, result);
  } catch (err) {
    let returned = err;
    returned.fileName = path;
    callback(returned);
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
