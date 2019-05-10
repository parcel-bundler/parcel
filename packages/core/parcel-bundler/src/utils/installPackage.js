const config = require('./config');
const {promisify} = require('@parcel/utils');
const resolve = promisify(require('resolve'));
const commandExists = require('command-exists');
const logger = require('@parcel/logger');
const pipeSpawn = require('./pipeSpawn');
const PromiseQueue = require('./PromiseQueue');
const path = require('path');
const fs = require('@parcel/fs');
const WorkerFarm = require('@parcel/workers');

const YARN_LOCK = 'yarn.lock';
const PNPM_LOCK = 'pnpm-lock.yaml';

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

  let commandToUse = packageManager.endsWith('npm') ? 'install' : 'add';
  let args = [commandToUse, ...modules];
  if (saveDev) {
    args.push('-D');
  } else if (packageManager.endsWith('npm')) {
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
  const yarnLockFile = await config.resolve(filepath, [YARN_LOCK]);

  /**
   * yarn.lock => Use yarn
   * pnpm-lock.yaml => Use pnpm
   * fallback to npm
   */
  if (yarnLockFile) {
    const hasYarn = await checkForCommand('yarn');
    if (hasYarn) {
      return 'yarn';
    }
  }

  const pnpmLockFile = await config.resolve(filepath, [PNPM_LOCK]);

  if (pnpmLockFile) {
    const hasPnpm = await checkForCommand('pnpm');
    if (hasPnpm) {
      return 'pnpm';
    }
  }

  return 'npm';
}

const commandCache = new Map();
async function checkForCommand(command) {
  if (commandCache.has(command)) {
    return commandCache.get(command);
  }

  let hasCommand = false;
  try {
    hasCommand = await commandExists(command);
    commandCache.set(command, hasCommand);
  } catch (err) {}

  return hasCommand;
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
