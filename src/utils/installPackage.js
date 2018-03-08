const spawn = require('cross-spawn');
const config = require('./config');
const promisify = require('./promisify');
const resolve = promisify(require('resolve'));
const commandExists = require('command-exists');
const logger = require('../Logger');

async function install(configObj) {
  let {
    dir: cwd,
    modules,
    installPeers = true,
    saveDev = true,
    packageManager
  } = configObj;

  packageManager = packageManager || (await determinePackageManager(cwd));
  let commandToUse = packageManager === 'npm' ? 'install' : 'add';
  let args = [commandToUse, ...modules, saveDev ? '-D' : null];

  await run(packageManager, args, {cwd});

  if (installPeers) {
    await Promise.all(modules.map(m => installPeerDependencies(cwd, m)));
  }
}

async function installPeerDependencies(dir, name) {
  const [resolved] = await resolve(name, {basedir: dir});
  const pkg = await config.load(resolved, ['package.json']);
  const peers = pkg.peerDependencies || {};

  const modules = [];
  for (const peer in peers) {
    modules.push(`${peer}@${peers[peer]}`);
  }

  if (modules.length) {
    await install({dir, modules, installPeers: false});
  }
}

async function determinePackageManager(cwd) {
  let yarnLockFile = await config.resolve(cwd, ['yarn.lock']);
  let yarnCommandExists = await checkForYarnCommand();

  // If the yarn command exists and we find a yarn lockfile, use yarn
  if (yarnCommandExists) {
    if (yarnLockFile) {
      return 'yarn';
    } else {
      logger.warn(
        "Using NPM instead of Yarn. No 'yarn.lock' found in project directory, use the --package-manager flag to explicitly specify which package manager to use."
      );
    }
  }

  return 'npm';
}

async function checkForYarnCommand() {
  try {
    return await commandExists('yarn');
  } catch (err) {
    return false;
  }
}

function run(...args) {
  return new Promise((resolve, reject) => {
    // Spawn the process
    let childProcess = spawn(...args);

    // Setup outputs
    childProcess.stdout.pipe(process.stdout);
    childProcess.stderr.pipe(process.stderr);

    // Resolve the promise when the process finishes
    childProcess.on('close', statusCode => {
      if (statusCode === 0) {
        resolve();
      } else {
        reject(new Error(`Install failure: ${args}`));
      }
    });
  });
}

module.exports = install;
