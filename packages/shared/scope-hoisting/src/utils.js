const t = require('@babel/types');

function getName(asset, type, ...rest) {
  return (
    '$' +
    t.toIdentifier(asset.id) +
    '$' +
    type +
    (rest.length
      ? '$' +
        rest
          .map(name => (name === 'default' ? name : t.toIdentifier(name)))
          .join('$')
      : '')
  );
}

function getIdentifier(asset, type, ...rest) {
  return t.identifier(getName(asset, type, ...rest));
}

function getExportIdentifier(asset, name) {
  return getIdentifier(asset, 'export', name);
}

exports.getName = getName;
exports.getIdentifier = getIdentifier;
exports.getExportIdentifier = getExportIdentifier;
