require('v8-compile-cache');
const Pipeline = require('../Pipeline');
const Path = require('path');
const child = require('./child');
const WorkerFarm = require('./WorkerFarm');

const BASEPATH = '../';

let pipeline;

function init(options) {
  pipeline = new Pipeline(options || {});
  Object.assign(process.env, options.env || {});
  process.env.WORKER_TYPE = 'parcel-worker';
  process.env.HMR_PORT = options.hmrPort;
  process.env.HMR_HOSTNAME = options.hmrHostname;
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
  if (request.location) {
    request.location = Path.join(BASEPATH, request.location);
  }
  if (process.send && process.env.WORKER_TYPE === 'parcel-worker') {
    return child.addCall(request, awaitResponse);
  } else {
    return WorkerFarm.getShared().processRequest(request);
  }
}

exports.init = init;
exports.run = run;
exports.addCall = addCall;
