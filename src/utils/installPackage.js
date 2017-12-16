const {spawn} = require('child_process');
const config = require('./config');

module.exports = async function(dir, name) {
  let yarn;
  try {
    yarn = await config.resolve(dir, ['yarn.lock']);
  } catch (e) {}

  return new Promise((resolve, reject) => {
    let options = {
      cwd: dir
    };

    let install = spawn('yarn', ['add', name, '--dev'], options);
    if (!yarn) {
      install = spawn('npm', ['install', name, '--save-dev'], options);
    }

    install.stdout.on('data', data => {
      // TODO: Log this using logger
      // console.log(data.toString());
    });

    install.stderr.on('data', data => {
      // TODO: Log this using logger
      // console.log(data.toString());
    });

    install.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Failed to install ${name}.`));
      }
      return resolve();
    });
  });
};
