const childProcess = require('child_process');
const childModule =
  parseInt(process.versions.node, 10) < 8
    ? require.resolve('../../lib/workerfarm/child')
    : require.resolve('../../src/workerfarm/child');

function fork(forkModule, childId) {
  // suppress --debug / --inspect flags while preserving others (like --harmony)
  let filteredArgs = process.execArgv.filter(
    v => !/^--(debug|inspect)/.test(v)
  );
  let options = {
    execArgv: filteredArgs,
    env: process.env,
    cwd: process.cwd()
  };
  let child = childProcess.fork(childModule, process.argv, options);

  child.on('error', function() {
    // this *should* be picked up by onExit and the operation requeued
  });

  let sendQueue = [];
  let processQueue = true;

  function send(data) {
    if (!processQueue) {
      return sendQueue.push(data);
    }

    let result = child.send(data, error => {
      if (error && error instanceof Error) {
        // Ignore this, the workerfarm handles child errors
        return;
      }

      processQueue = true;

      if (sendQueue.length > 0) {
        let queueCopy = sendQueue.slice(0);
        sendQueue = [];
        queueCopy.forEach(entry => send(entry));
      }
    });

    if (!result || /^win/.test(process.platform)) {
      // Queue is handling too much messages throttle it
      processQueue = false;
    }
  }

  send({module: forkModule, child: childId});

  // return a send function for this child
  return {send, child};
}

module.exports = fork;
