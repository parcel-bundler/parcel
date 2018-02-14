const spawn = require('cross-spawn');
const config = require('./config');
const path = require('path');
const promisify = require('./promisify');
const resolve = promisify(require('resolve'));
const commandExists = require('command-exists').sync;

async function install(dir, modules, installPeers = true, saveDev = true) {
  let location = await config.resolve(dir, ['yarn.lock', 'package.json']);

  return new Promise((resolve, reject) => {
    let install;
    let options = {
      cwd: location ? path.dirname(location) : dir
    };

    let args = ['add', ...modules];
    if (saveDev) {
      args.push('-D');
    }

    let command = 'npm';
    if (commandExists('yarn')) {
      command = 'yarn';
    }

    install = spawn(command, args, options);

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
