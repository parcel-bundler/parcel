const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const { transformFromAst, File: BabelFile } = require('babel-core');
const findUp = require('find-up');
const resolveFrom = require('resolve-from');
const Emittery = require('emittery');

const readFile = promisify(fs.readFile);

let emitter = new Emittery();
emitter.onAny((eventName, data) => {
  process.send({ eventName, ...data });
});

process.on('message', async (filePath) => {
  let processed = await doTheWork(filePath);
  process.send({ eventName: 'finished', data: processed });
});

async function doTheWork(filePath) {
  let babelConfigPath = await findUp('.babelrc');
  babelConfig = JSON.parse(await readFile(babelConfigPath));
  babelFile = new BabelFile(babelConfig);

  let fileContents = await readFile(filePath, 'utf8');
  let ast = babylon.parse(fileContents, {
    sourceType: 'module',
    plugins: babelFile.parserOpts.plugins
  });

  let dependencyRequests = [];
  traverse(ast, {
    ImportDeclaration: ({ node }) => {
      dependencyRequests.push(node.source.value);
      emitter.emit('foundDepRequest', { sourcePath: filePath, moduleIdentifier: node.source.value })
    },
  });

  let { plugins, presets } = babelConfig;
  let { code } = transformFromAst(ast, null, { plugins, presets });

  return { code };
}
