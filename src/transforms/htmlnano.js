const posthtml = require('posthtml');
const htmlnano = require('htmlnano');

module.exports = async function(ast, state) {
  await state.parseIfNeeded();

  let htmlNanoConfig = await state.getConfig(
    ['.htmlnanorc', '.htmlnanorc.js'],
    {packageKey: 'htmlnano'}
  );
  let res = await posthtml([htmlnano(htmlNanoConfig)]).process(ast, {
    skipParse: true
  });

  state.isAstDirty = true;

  return res.tree;
};
