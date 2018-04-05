module.exports = async function(asset) {
  let config =
    asset.package.webmanifest ||
    (await asset.getConfig([
      '.webmanifestrc',
      '.webmanifestrc.js',
      'webmanifest.config.js'
    ]));
  if (!config && !asset.options.minify) {
    return;
  }

  await asset.parseIfNeeded();
  let res = await config(asset.ast);

  asset.ast = res;
  asset.isAstDirty = true;
};
