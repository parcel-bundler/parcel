const path = require('path');
const resolveFrom = require('resolve-from');
const { isDirectory } = require('./fsPromisified');

process.on('message', async (moduleRequest) => {
  let resolvedPath = await doTheWork(moduleRequest);
  process.send({ resolvedPath, ...moduleRequest });
});

async function doTheWork({ sourcePath, moduleIdentifier }) {
  let sourceDir = await isDirectory(sourcePath) ? sourcePath : path.dirname(sourcePath);

  return resolveFrom(sourceDir, moduleIdentifier);
}
