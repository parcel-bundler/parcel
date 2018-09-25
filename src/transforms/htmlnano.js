const posthtml = require('posthtml');
const htmlnano = require('htmlnano');

module.exports = async function(asset) {
  await asset.parseIfNeeded();

  let htmlNanoConfig = Object.assign(
    {},
    await asset.getConfig(['.htmlnanorc', '.htmlnanorc.js'], {
      packageKey: 'htmlnano'
    }),
    {
      minifyCss: false,
      minifyJs: false
    }
  );

  let res = await posthtml([htmlnano(htmlNanoConfig)]).process(asset.ast, {
    skipParse: true
  });

  asset.ast = res.tree;
  asset.isAstDirty = true;
};
