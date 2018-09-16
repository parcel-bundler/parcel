const localRequire = require('../../utils/localRequire');
const {babel6toBabel7} = require('./astConverter');

async function babel6(asset, options) {
  let babel = await localRequire('babel-core', asset.name);

  let config = options.config;
  config.code = false;
  config.ast = true;
  config.filename = asset.name;
  config.babelrc = false;
  config.parserOpts = Object.assign({}, config.parserOpts, {
    allowReturnOutsideFunction: true,
    allowHashBang: true,
    ecmaVersion: Infinity,
    strictMode: false,
    sourceType: 'module',
    locations: true,
    plugins: ['exportExtensions', 'dynamicImport']
  });

  let res = babel.transform(asset.contents, config);
  if (res.ast) {
    asset.ast = babel6toBabel7(res.ast);
    asset.isAstDirty = true;
  }
}

module.exports = babel6;
