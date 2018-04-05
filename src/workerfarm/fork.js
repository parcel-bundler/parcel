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

  child.send({module: forkModule, child: childId});

  // Delay data being send to the child with a tick, prevents win32 deadlock
  function send(data) {
    process.nextTick(() => {
      child.send(data);
    });
  }

  // return a send() function for this child
  return {
    send: send.bind(child),
    child: child
  };
}

module.exports = fork;
