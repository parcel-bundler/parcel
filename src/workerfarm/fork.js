const childProcess = require('child_process');
const childModule = require.resolve('./child');

function fork(forkModule) {
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

  child.send({module: forkModule});

  // return a send() function for this child
  return {
    send: child.send.bind(child),
    child
  };
}

module.exports = fork;
