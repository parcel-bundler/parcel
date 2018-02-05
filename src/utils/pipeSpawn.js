const spawn = require('cross-spawn');

function pipeSpawn(cmd, params, opts) {
  const cp = spawn(cmd, params, opts);
  cp.stdout.pipe(process.stdout);
  cp.stderr.pipe(process.stderr);
  return new Promise((resolve, reject) => {
    cp.on('error', reject);
    cp.on('close', function(code) {
      if (code !== 0) {
        return reject(new Error(cmd + ' failed.'));
      }

      return resolve();
    });
  });
}

module.exports = pipeSpawn;
