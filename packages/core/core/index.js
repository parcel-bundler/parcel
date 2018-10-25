function getIndex() {
  try {
    if (parseInt(process.versions.node, 10) < 8) {
      return require('./lib/legacy/Parcel').default;
    } else {
      return require('./lib/modern/Parcel').default;
    }
  } catch (e) {
    return require('./src/Parcel').default;
  }
}

module.exports = getIndex();
