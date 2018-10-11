const spawn = require('cross-spawn');
const logger = require('../Logger');

const PREFIX = 'child';

const logEachLine = type => (data = '') =>
  data
    .toString()
    .replace(/\s+$/, '')
    .split('\n')
    .forEach(line => logger.writeRaw(`[${PREFIX}][${type}] ${line}\n`));

async function spawnCommand(serverUrl, cmdWithParams) {
  const [cmd, ...params] = cmdWithParams.split(' ');

  const opts = {
    cwd: process.cwd(),
    env: Object.assign(process.env, {
      PARCEL_SERVER_URL: serverUrl
    })
  };

  const cp = spawn(cmd, params, opts);

  cp.stdout.on('data', logEachLine('log'));

  cp.stderr.on('data', logEachLine('error'));

  cp.on('error', err => {
    logEachLine('error')(err);
    logger.writeRaw('Spawned process failed, exiting main process...\n');
    process.exit();
  });

  cp.on('close', () => {
    logger.writeRaw('Spawned process is done, exiting main process...\n');
    process.exit();
  });
}

module.exports = spawnCommand;
