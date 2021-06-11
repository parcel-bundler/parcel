const EXCLUDED_PACKAGES = new Set(['@parcel/source-map', '@parcel/watcher']);

function getReplacementName(packageName) {
  return packageName.replace(/^@parcel\//, '@atlassian/parcel-');
}

function shouldReplace(packageName) {
  return (
    packageName.startsWith('@parcel/') && !EXCLUDED_PACKAGES.has(packageName)
  );
}

module.exports = {
  getReplacementName,
  shouldReplace,
};
