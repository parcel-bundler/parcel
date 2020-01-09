function shouldReplace(packageName) {
  return (
    packageName !== '@parcel/watcher' && packageName.startsWith('@parcel/')
  );
}

function getReplacementName(packageName) {
  return packageName.replace(/^@parcel\//, '@atlassian/parcel-');
}

module.exports = {
  shouldReplace,
  getReplacementName,
};
