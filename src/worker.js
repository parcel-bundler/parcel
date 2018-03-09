require('v8-compile-cache');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');

let parser;
let requests = [];
let childId = 0;

exports.init = function(options, callback) {
  childId = options.childId;
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

function sendRequest(data, callback) {
  if (!process.send) {
    const shared = WorkerFarm.getShared();
    if (shared) {
      shared
        .handleRequest(data)
        .then(response => {
          callback(response.result);
        })
        .catch(() => {});
    } else {
      callback({});
    }
  } else {
    data.child = childId;
    data.id = requests.push(callback) - 1;
    process.send(data);
  }
}

process.on('message', function(data) {
  if (data.type && typeof data.id === 'number' && data.id < requests.length) {
    const callback = requests[data.id];
    if (typeof callback === 'function') {
      callback(data.result);
    }
  }
});

process.on('unhandledRejection', function(err) {
  // ERR_IPC_CHANNEL_CLOSED happens when the worker is killed before it finishes processing
  if (err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
    console.error('Unhandled promise rejection:', err.stack);
  }
});

exports.sendRequest = sendRequest;
