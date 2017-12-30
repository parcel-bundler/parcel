const objectHash = require('./objectHash');

const getConfigHash = async function(asset) {
  return objectHash(await asset.getConfig());
};

const compare = async function(asset, configHash) {
  let assetHash = await getConfigHash(asset);

  return assetHash === configHash;
};

module.exports.getConfigHash = getConfigHash;
module.exports.compare = compare;
