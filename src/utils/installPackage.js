const exec = require('child_process').exec;

module.exports = function(dir, name) {
  return new Promise((resolve, reject) => {
    exec(
      `cd ${dir} && npm install ${name} --save-dev`,
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`Failed to install package ${name}`));
        }
        return resolve(name);
      }
    );
  });
};
