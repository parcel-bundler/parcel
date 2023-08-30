/* eslint-disable no-continue */
const {findConstantExports} = require('./find-constants');

async function transformFunc({asset}) {
  //TODO: We should add an array of filepaths or regular expressions s.t. only constants from those files will be inlined.

  if (!asset.fs.existsSync(asset.filePath)) {
    return [asset];
  }

  let code = await asset.fs.readFile(asset.filePath, 'utf8');

  const constantExports = await findConstantExports(code);

  asset.meta.constantExports = constantExports;

  return [asset];
}

module.exports = {
  transformFunc,
};
