const babel = require('babel-core');
const config = require('../utils/config');

module.exports = async function(asset) {
  if (!await shouldTransform(asset)) {
    return;
  }

  await asset.parseIfNeeded();

  let babelrc =
    (await config.load(asset.name, ['.babelrc', '.babelrc.js'])) || {};
  let babelConfig = Object.assign(babelrc, {
    code: false,
    filename: asset.name,
    babelrc: false
  });

  // TODO: Support .babelignore

  if (asset.isES6Module) {
    babelConfig.plugins = (babelConfig.plugins || []).concat([
      require('babel-plugin-transform-es2015-modules-commonjs')
    ]);
  }

  babelConfig.presets = (babelConfig.presets || []).map(preset =>
    setBabelExtOptions(
      preset,
      ['env', 'babel-preset-env', '@babel/preset-env'],
      {
        modules: false
      }
    )
  );

  let res = babel.transformFromAst(asset.ast, asset.contents, babelConfig);
  if (!res.ignored) {
    asset.ast = res.ast;
    asset.isAstDirty = true;
  }
};

function setBabelExtOptions(ext, names, opts) {
  names = Array.isArray(names) ? names : [names];
  if (Array.isArray(ext) && names.indexOf(ext[0]) > -1) {
    return [ext[0], Object.assign(ext[1] || {}, opts)];
  } else if (names.indexOf(ext) > -1) {
    return [ext, opts];
  }
  return ext;
}

async function shouldTransform(asset) {
  if (asset.isES6Module) {
    return true;
  }

  if (asset.ast) {
    return !!asset.babelConfig;
  }

  if (asset.package && asset.package.babel) {
    return true;
  }

  let babelrc = await config.resolve(asset.name, ['.babelrc', '.babelrc.js']);
  return !!babelrc;
}
