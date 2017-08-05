const fs = require('./utils/fs');
const Module = require('./Module');
const Parser = require('./Parser');
const babel = require('babel-core');

process.on('unhandledRejection', console.error)

let parser;

module.exports = async function (path, options, callback) {
  if (!parser) {
    parser = new Parser(options || {});
  }

  let mod = new Module(path, options);
  mod.code = await fs.readFile(path, 'utf8');
  mod.ast = parser.parse(path, mod.code);
  mod.collectDependencies();

  // let res = babel.transformFromAst(mod.ast);
  // console.log(res.code)
  callback(null, Array.from(mod.dependencies));
};
