const spawn = require('cross-spawn');
const config = require('./config');
const path = require('path');
const resolve = require('resolve');

const installPeerDependencies = async (dir, name) => {
  let basedir = path.dirname(dir);

  const resolved = resolve.sync(name, {basedir});
  const pkg = await config.load(resolved, ['package.json']);
  const peers = pkg.peerDependencies || {};

  for (const peer in peers) {
    await install(dir, `${peer}@${peers[peer]}`, false);
  }
};

const install = async function(dir, name, installPeers = true) {
  let location = await config.resolve(dir, ['yarn.lock', 'package.json']);

  return new Promise((resolve, reject) => {
    let install;
    let options = {
      cwd: location ? path.dirname(location) : dir
    };

    if (location && path.basename(location) === 'yarn.lock') {
      install = spawn('yarn', ['add', name, '--dev'], options);
    } else {
      install = spawn('npm', ['install', name, '--save-dev'], options);
    }

    install.stdout.pipe(process.stdout);
    install.stderr.pipe(process.stderr);

    install.on('close', async code => {
      if (code !== 0) {
        return reject(new Error(`Failed to install ${name}.`));
      }

      if (!installPeers) {
        return resolve();
      }

      try {
        await installPeerDependencies(dir, name);
      } catch (err) {
        return reject(
          new Error(`Failed to install peerDependencies for ${name}.`)
        );
      }

      resolve();
    });
  });
};

module.exports = install;
