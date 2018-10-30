const {isMatch} = require('micromatch');
const {basename} = require('path');

module.exports = (config, file) => {
  for (let pattern in config) {
    if (isMatch(file, pattern) || isMatch(basename(file), pattern)) {
      return config[pattern];
    }
  }

  return null;
};
