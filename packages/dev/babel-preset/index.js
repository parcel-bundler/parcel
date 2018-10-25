const preset =
  parseInt(process.versions.node, 10) < 8
    ? require('./legacy')
    : require('./modern');

module.exports = preset;
