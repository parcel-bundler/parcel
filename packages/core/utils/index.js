function getIndex() {
  try {
    if (parseInt(process.versions.node, 10) < 8) {
      return require('./lib/legacy').default;
    } else {
      return require('./lib/modern').default;
    }
  } catch (e) {
    return require('./src').default;
  }
}

module.exports = getIndex();
