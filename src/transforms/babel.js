const babel = require('babel-core');
const fs = require('../utils/fs');
const path = require('path');

module.exports = async function (asset) {
  if (!(await shouldTransform(asset))) {
    return;
  }

  // console.time ('babel: ' + process.pid + ':' + asset.name)

  await asset.parseIfNeeded();

  let res = babel.transformFromAst(asset.ast, asset.contents, {code: true, filename: asset.name});
  asset.ast = res.ast;
  asset.contents = res.code;
  // console.timeEnd('babel: ' + process.pid + ':' + asset.name)
};

async function shouldTransform(asset) {
  if (/\.json$/.test(asset.name)) {
    return false;
  }

  if (asset.package && asset.package.babel) {
    return true;
  }

  // if (asset.package && asset.package.browserify && asset.package.browserify.transforms && asset.package.browserify.transforms.includes('babelify')) {
  //   return true;
  // }

  let babelrc = await resolveBabelRc(path.dirname(asset.name));
  if (babelrc) {
    return true;
  }

  return false;
}

async function resolveBabelRc(filepath, root = '/') {
  for (const filename of ['.babelrc', '.babelrc.js']) {
    let file = path.join(filepath, filename);
    if (await fs.exists(file)) {
      return file;
    }
  }

  filepath = path.dirname(filepath);

  // Don't traverse above the module root
  if (filepath !== root && path.basename(filepath) !== 'node_modules') {
    return resolveBabelRc(filepath, root);
  }
}
