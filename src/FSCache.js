const fs = require('./utils/fs');
const path = require('path');
const md5 = require('./utils/md5');

class FSCache {
  constructor(options) {
    this.dir = path.resolve(options.cacheDir || '.cache');
    this.dirExists = false;
    this.invalidated = new Set;
  }

  async ensureDirExists() {
    await fs.mkdirp(this.dir);
    this.dirExists = true;
  }

  async write(filename, data) {
    let hash = md5(filename);
    let cacheFile = path.join(this.dir, hash + '.json');

    try {
      await this.ensureDirExists();
      await fs.writeFile(cacheFile, JSON.stringify(data));
      this.invalidated.delete(filename);
    } catch (err) {
      console.error('Error writing to cache', err);
    }
  }

  async read(filename) {
    if (this.invalidated.has(filename)) {
      return null;
    }

    let hash = md5(filename);
    let cacheFile = path.join(this.dir, hash + '.json');

    try {
      let stats = await fs.stat(filename);
      let cacheStats = await fs.stat(cacheFile);

      if (stats.mtime > cacheStats.mtime) {
        return null;
      }

      let data = await fs.readFile(cacheFile);
      return JSON.parse(data);
    } catch (err) {
      return null;
    }
  }

  invalidate(filename) {
    this.invalidated.add(filename);
  }

  async delete(filename) {
    let hash = md5(filename);
    let cacheFile = path.join(this.dir, hash + '.json');

    try {
      await fs.unlink(cacheFile);
      this.invalidated.delete(filename);
    } catch (err) {}
  }
}

module.exports = FSCache;
