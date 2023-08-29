/* eslint-disable no-continue */
const {findConstantExports} = require('./find-constants');

async function transformFunc({asset}) {
  if (!asset.fs.existsSync(asset.filePath)) {
    return [asset];
  }

  const code = await asset.fs.readFile(asset.filePath, 'utf8');

  const constantExports = await findConstantExports(code);

  asset.meta.constantExports = constantExports;

  console.log(asset.filePath);
  console.log('🚀 ~ Asset meta', asset.meta);

  return [asset];
}

module.exports = {
  transformFunc,
};
