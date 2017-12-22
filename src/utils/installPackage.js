const spawn = require('cross-spawn');
const config = require('./config');
const path = require('path');

module.exports = async function(dir, name) {
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

    install.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Failed to install ${name}.`));
      }
      return resolve();
    });
  });
};
