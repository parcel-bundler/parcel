function getIndex() {
  try {
    if (parseInt(process.versions.node, 10) < 8) {
      return require('./lib/legacy');
    } else {
      return require('./lib/modern');
    }
  } catch (e) {
    return require('./src');
  }
}

module.exports = getIndex();
