const spawn = require('cross-spawn');
const config = require('./config');
const promisify = require('./promisify');
const resolve = promisify(require('resolve'));
const commandExists = require('command-exists').sync;
const logger = require('../Logger');

function install(
  dir,
  modules,
  installPeers = true,
  saveDev = true,
  packageManager
) {
  return new Promise(async (resolve, reject) => {
    let install;
    let options = {
      cwd: dir
    };

    // Attempt to resolve the yarn lockfile
    let yarnLockFile = await config.resolve(dir, ['yarn.lock']);

    let packageManagerToUse;
    if (packageManager) {
      packageManagerToUse = packageManager;
    } else {
      // If no package manager specified, try to figure out which one to use:
      // Default to npm
      packageManagerToUse = 'npm';
      // If the yarn command exists and we find a yarn.lock, use yarn
      if (commandExists('yarn')) {
        if (yarnLockFile) {
          packageManagerToUse = 'yarn';
        } else {
          logger.warn(
            "Using NPM instead of Yarn. No 'yarn.lock' found in project directory, use the --package-manager flag to explicitly specify which package manager to use."
          );
        }
      }
    }

    let commandToUse;
    if (packageManagerToUse === 'npm') {
      commandToUse = 'install';
    } else {
      commandToUse = 'add';
    }

    let args = [commandToUse, ...modules];

    if (saveDev) {
      args.push('-D');
    }

    install = spawn(packageManagerToUse, args, options);

    install.stdout.pipe(process.stdout);
    install.stderr.pipe(process.stderr);

    install.on('close', async code => {
      if (code !== 0) {
        return reject(new Error(`Failed to install ${modules.join(', ')}.`));
      }

      if (!installPeers) {
        return resolve();
      }

      try {
        await Promise.all(modules.map(m => installPeerDependencies(dir, m)));
      } catch (err) {
        return reject(
          new Error(
            `Failed to install peerDependencies for ${modules.join(', ')}.`
          )
        );
      }

      resolve();
    });
  });
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
    await install(dir, modules, false);
  }
}

module.exports = install;
