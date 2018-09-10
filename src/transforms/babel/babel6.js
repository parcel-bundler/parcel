const localRequire = require('../../utils/localRequire');
const {babel6toBabel7} = require('./astConverter');

async function babel6(asset, config) {
  let babel = await localRequire('babel-core', asset.name);

  config.code = false;
  config.ast = true;
  config.filename = asset.name;
  config.babelrc = false;

  let res = babel.transform(asset.contents, config);
  if (res.ast) {
    asset.ast = babel6toBabel7(res.ast);
    asset.isAstDirty = true;
  }
}

module.exports = babel6;
