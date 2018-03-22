const posthtml = require('posthtml');
const htmlnano = require('htmlnano');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  const htmlNanoConfig = asset.package.htmlnano ||
    (await asset.getConfig(['.htmlnanorc', '.htmlnanorc.js'])) || {
      collapseWhitespace: 'conservative',
      minifyCss: {
        safe: true
      }
    };

  let res = await posthtml([htmlnano(htmlNanoConfig)]).process(asset.ast, {
    skipParse: true
  });

  asset.ast = res.tree;
  asset.isAstDirty = true;
};
