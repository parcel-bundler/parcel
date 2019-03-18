const os = require('os');

module.exports = () => {
  let cores;
  try {
    cores = require('physical-cpu-count');
  } catch (err) {
    cores = os.cpus().length;
  }
  return cores || 1;
};
