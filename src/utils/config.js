const fs = require('./fs');
const path = require('path');

const existsCache = new Map;

async function resolve(filepath, filenames, root = '/') {
  filepath = path.dirname(filepath);

  // Don't traverse above the module root
  if (filepath === root || path.basename(filepath) === 'node_modules') {
    return null;
  }

  for (const filename of filenames) {
    let file = path.join(filepath, filename);
    let exists = existsCache.has(file) ? existsCache.get(file) : await fs.exists(file);
    if (exists) {
      existsCache.set(file, true);
      return file;
    }

    existsCache.set(file, false);
  }

  return resolve(filepath, filenames, root);
}

async function load(filepath, filenames, root = '/') {
  let configFile = await resolve(filepath, filenames, root);
  if (configFile) {
    if (path.extname(configFile) === '.js') {
      return require(configFile);
    }

    return JSON.parse(await fs.readFile(configFile));
  }

  return null;
}

exports.resolve = resolve;
exports.load = load;
