const {spawn} = require('child_process');
const config = require('./config');
const path = require('path');

async function getLocation(dir) {
  try {
    return await config.resolve(dir, ['yarn.lock']);
  } catch (e) {
    try {
      return await config.resolve(dir, ['package.json']);
    } catch (e) {
      // TODO: log a warning
      return dir;
    }
  }
}

module.exports = async function(dir, name) {
  let location = await getLocation(dir);

  return new Promise((resolve, reject) => {
    let install;
    let options = {};

    if (location.indexOf('yarn.lock') > -1) {
      options.cwd = path.dirname(location);
      install = spawn('yarn', ['add', name, '--dev'], options);
    } else {
      options.cwd = path.dirname(location);
      install = spawn('npm', ['install', name, '--save-dev'], options);
    }

    install.stdout.on('data', data => {
      // TODO: Log this using logger
      data
        .toString()
        .split('\n')
        .forEach(message => {
          if (message !== '') {
            console.log(message);
          }
        });
    });

    install.stderr.on('data', data => {
      // TODO: Log this using logger
      data
        .toString()
        .split('\n')
        .forEach(message => {
          if (message !== '') {
            console.log(message);
          }
        });
    });

    install.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Failed to install ${name}.`));
      }
      return resolve();
    });
  });
};
