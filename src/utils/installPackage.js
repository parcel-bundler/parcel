const {spawn} = require('child_process');
const config = require('./config');

function testYarn(options) {
  return new Promise((resolve, reject) => {
    let yarnVersion = spawn('yarn', ['-v'], options);

    yarnVersion.once('close', code => {
      if (code !== 0) {
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

module.exports = async function(dir, name) {
  let options = {
    cwd: dir
  };

  let yarn = await testYarn(options);

  return new Promise((resolve, reject) => {
    let install;
    if (yarn) {
      install = spawn('yarn', ['add', name, '--dev'], options);
    } else {
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

    install.once('close', code => {
      if (code !== 0) {
        return reject(new Error(`Failed to install ${name}.`));
      }
      return resolve();
    });
  });
};
