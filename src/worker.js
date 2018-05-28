require('v8-compile-cache');
const Pipeline = require('./Pipeline');
const WorkerFarm = require('./workerfarm/WorkerFarm');

let pipeline;
let child;

function setChildReference(childReference) {
  child = childReference;
}

function init(options) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {}, {
    PARCEL_WORKER_TYPE: child ? 'remote-worker' : 'local-worker'
  });
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
}

async function run(path, id, isWarmUp) {
  try {
    return await pipeline.process(path, id, isWarmUp);
  } catch (e) {
    e.fileName = path;
    throw e;
  }
}

// request.location is a module path relative to src or lib
async function addCall(request, awaitResponse = true) {
  if (process.send && process.env.PARCEL_WORKER_TYPE === 'remote-worker') {
    return child.addCall(request, awaitResponse);
  } else {
    return WorkerFarm.getShared().processRequest(request);
  }
}

exports.init = init;
exports.run = run;
exports.addCall = addCall;
exports.setChildReference = setChildReference;
