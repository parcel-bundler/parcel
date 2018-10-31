const spawn = require('cross-spawn');
// const logger = require('@parcel/logger');

function pipeSpawn(cmd, params, opts) {
  const cp = spawn(
    cmd,
    params,
    Object.assign(
      {
        env: Object.assign(
          {
            FORCE_COLOR: false, //logger.color,
            npm_config_color: 'always', //logger.color ? 'always' : '',
            npm_config_progress: true
          },
          process.env,
          {NODE_ENV: null} // Passing NODE_ENV through causes strange issues with yarn
        )
      },
      opts
    )
  );

  cp.stdout
    .setEncoding('utf8')
    .on('data', d => console.log(d) /*logger.writeRaw(d)*/);
  cp.stderr
    .setEncoding('utf8')
    .on('data', d => console.log(d) /*logger.writeRaw(d)*/);

  return new Promise((resolve, reject) => {
    cp.on('error', reject);
    cp.on('close', function(code) {
      if (code !== 0) {
        return reject(new Error(cmd + ' failed.'));
      }

      // logger.clear();
      return resolve();
    });
  });
}

module.exports = pipeSpawn;
