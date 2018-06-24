require('v8-compile-cache');
const Pipeline = require('./Pipeline');

let pipeline;

function init(options) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {});
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
function addCall(request, awaitResponse = true) {
  if (process.send && process.parcelWorker) {
    return process.parcelRequest(request, awaitResponse);
  } else {
    const WorkerFarm = require('./workerfarm/WorkerFarm');

    return WorkerFarm.getShared().processRequest(request);
  }
}

exports.init = init;
exports.run = run;
exports.addCall = addCall;
