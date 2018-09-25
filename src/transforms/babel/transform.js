const babel6 = require('./babel6');
const babel7 = require('./babel7');
const getBabelConfig = require('./config');

async function babelTransform(asset) {
  let config = await getBabelConfig(asset);

  if (config[6]) {
    await babel6(asset, config[6]);
  }

  if (config[7]) {
    await babel7(asset, config[7]);
  }

  return asset.ast;
}

module.exports = babelTransform;
