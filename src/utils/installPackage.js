const spawn = require('cross-spawn');
const config = require('./config');
const path = require('path');
const promisify = require('./promisify');
const resolve = promisify(require('resolve'));
const commandExists = require('command-exists').sync;
const logger = require('../Logger');

async function install(
  dir,
  modules,
  installPeers = true,
  saveDev = true,
  packageManager
) {
  let projectRootLocation = dir;

  let configFileLocation = await config.resolve(dir, [
    'yarn.lock',
    'package.json'
  ]);

  if (configFileLocation) {
    projectRootLocation = path.dirname(configFileLocation);
  }

  return new Promise(async (resolve, reject) => {
    let install;
    let options = {
      cwd: projectRootLocation,
      env: Object.assign(
        {
          FORCE_COLOR: logger.color
        },
        process.env
      )
    };

    let packageManagerToUse;
    if (packageManager) {
      packageManagerToUse = packageManager;
    } else {
      // If no package manager specified, try to figure out which one to use:
      // Default to npm
      packageManagerToUse = 'npm';
      // If the yarn command exists and we find a yarn.lock, use yarn
      if (commandExists('yarn')) {
        if (
          !configFileLocation ||
          path.basename(configFileLocation) === 'yarn.lock'
        ) {
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

    // install.stdout.pipe(process.stdout);
    install.stdout.setEncoding('utf8').on('data', d => logger.writeRaw(d));
    install.stderr.setEncoding('utf8').on('data', d => logger.writeRaw(d));

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

      logger.clear();
      resolve();
    });
  });
}

async function installPeerDependencies(dir, name) {
  let basedir = path.dirname(dir);

  const [resolved] = await resolve(name, {basedir});
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
