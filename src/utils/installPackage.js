const config = require('./config');
const promisify = require('./promisify');
const resolve = promisify(require('resolve'));
const commandExists = require('command-exists');
const logger = require('../Logger');
const pipeSpawn = require('./pipeSpawn');
const PromiseQueue = require('./PromiseQueue');
const path = require('path');
const fs = require('./fs');
const WorkerFarm = require('../workerfarm/WorkerFarm');

const YARN_LOCK = 'yarn.lock';
const PACKAGE_LOCK = 'package-lock.json';

async function install(modules, filepath, options = {}) {
  let {installPeers = true, saveDev = true, packageManager} = options;
  if (typeof modules === 'string') {
    modules = [modules];
  }

  logger.progress(`Installing ${modules.join(', ')}...`);

  let packageLocation = await config.resolve(filepath, ['package.json']);
  let cwd = packageLocation ? path.dirname(packageLocation) : process.cwd();

  if (!packageManager) {
    packageManager = await determinePackageManager(filepath);
  }

  let commandToUse = packageManager === 'npm' ? 'install' : 'add';
  let args = [commandToUse, ...modules];
  if (saveDev) {
    args.push('-D');
  } else if (packageManager === 'npm') {
    args.push('--save');
  }

  // npm doesn't auto-create a package.json when installing,
  // so create an empty one if needed.
  if (packageManager === 'npm' && !packageLocation) {
    await fs.writeFile(path.join(cwd, 'package.json'), '{}');
  }

  try {
    await pipeSpawn(packageManager, args, {cwd});
  } catch (err) {
    throw new Error(`Failed to install ${modules.join(', ')}.`);
  }

  if (installPeers) {
    await Promise.all(
      modules.map(m => installPeerDependencies(filepath, m, options))
    );
  }
}

async function installPeerDependencies(filepath, name, options) {
  let basedir = path.dirname(filepath);
  const [resolved] = await resolve(name, {basedir});
  const pkg = await config.load(resolved, ['package.json']);
  const peers = pkg.peerDependencies || {};

  const modules = [];
  for (const peer in peers) {
    modules.push(`${peer}@${peers[peer]}`);
  }

  if (modules.length) {
    await install(
      modules,
      filepath,
      Object.assign({}, options, {installPeers: false})
    );
  }
}

async function determinePackageManager(filepath) {
  const [npmLockFile, yarnLockFile] = await Promise.all([
    config.resolve(filepath, [PACKAGE_LOCK]),
    config.resolve(filepath, [YARN_LOCK])
  ]);
  const hasYarn = await checkForYarnCommand();

  /**
   * There is package-lock.json -> Use npm
   * There is yarn.lock & yarn command -> Use Yarn
   * Otherwise -> Use npm
   */
  if (npmLockFile) {
    return 'npm';
  }
  if (hasYarn && yarnLockFile) {
    return 'yarn';
  }
  return 'npm';
}

let hasYarn = null;
async function checkForYarnCommand() {
  if (hasYarn != null) {
    return hasYarn;
  }

  try {
    hasYarn = await commandExists('yarn');
  } catch (err) {
    hasYarn = false;
  }

  return hasYarn;
}

let queue = new PromiseQueue(install, {maxConcurrent: 1, retry: false});
module.exports = async function(...args) {
  // Ensure that this function is always called on the master process so we
  // don't call multiple installs in parallel.
  if (WorkerFarm.isWorker()) {
    await WorkerFarm.callMaster({
      location: __filename,
      args
    });
    return;
  }

  queue.add(...args);
  return queue.run();
};
