const gitly = require('gitly').default;
const {join, resolve, extname} = require('path');
const {
  mkdir,
  pathExists,
  copy,
  writeFile,
  readdir,
  readFile,
  remove,
} = require('fs-extra');

const numCopy = 4;
const rootFolder = __dirname;
const extractFolder = join(rootFolder, 'github');
const originalSrcFolder = join(extractFolder, 'src');
const srcFolder = join(rootFolder, 'src');

async function setup() {
  await remove(join(rootFolder, 'dist'));

  if (await pathExists(srcFolder)) {
    return console.log('src folder already exists.');
  }

  if (!(await pathExists(extractFolder))) {
    console.log('Downloading and extracting three.js...');
    await gitly('http://github.com/mrdoob/three.js#r108', extractFolder);
  } else {
    console.log('three.js is already downloaded...');
  }

  console.log('Creating src folder...');
  await mkdir(srcFolder);
  let copyP = new Array(numCopy);
  let entry = '';
  for (let iCopy = 0; iCopy < numCopy; iCopy++) {
    copyP[iCopy] = copy(originalSrcFolder, join(srcFolder, `copy${iCopy}`));
    entry += `import * as copy${iCopy} from './copy${iCopy}/Three.js';\n`;
  }
  await Promise.all(copyP);
  await writeFile(join(srcFolder, 'entry.js'), entry);

  const lineCount = (await getLineCount(join(srcFolder, 'copy0'))) * numCopy;
  console.log(`Line count: ${lineCount}`);
}
setup().catch(async e => {
  await remove(srcFolder);
  throw e;
});

async function getLineCount(dir, extension = '.js') {
  const filesPaths = (await readdirR(dir)).filter(
    filePath => extname(filePath) === extension,
  );
  const files = await Promise.all(
    filesPaths.map(file => readFile(file, {encoding: 'utf8'})),
  );
  const newLineRegex = /\r?\n/g;
  const fileLines = files.map(file => file.match(newLineRegex)).flat().length;
  return fileLines;
}

async function readdirR(dir) {
  const dirents = await readdir(dir, {withFileTypes: true});
  const files = await Promise.all(
    dirents.map(dirent => {
      const res = resolve(dir, dirent.name);
      return dirent.isDirectory() ? readdirR(res) : res;
    }),
  );
  return files.flat();
}
