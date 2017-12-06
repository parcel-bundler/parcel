// @flow
const fs = require('./utils/fs');
const path = require('path');
const md5 = require('./utils/md5');
const objectHash = require('./utils/objectHash');

// These keys can affect the output, so if they differ, the cache should not match
const OPTION_KEYS = ['publicURL', 'minify', 'hmr'];

export type FSCacheOptions = {
  cacheDir?: string,
  publicURL?: string,
  minify?: string,
  hmr?: string
};

class FSCache {
  dir: string;
  dirExists: boolean;
  invalidated: Set<string>;
  optionsHash: string;

  constructor(options: FSCacheOptions) {
    this.dir = path.resolve(options.cacheDir || '.cache');
    this.dirExists = false;
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p, k) => ((p[k] = options[k]), p), {})
    );
  }

  async ensureDirExists() {
    await fs.mkdirp(this.dir);
    this.dirExists = true;
  }

  getCacheFile(filename: string) {
    let hash = md5(this.optionsHash + filename);
    return path.join(this.dir, hash + '.json');
  }

  async write(filename: string, data: Object) {
    try {
      await this.ensureDirExists();
      await fs.writeFile(this.getCacheFile(filename), JSON.stringify(data));
      this.invalidated.delete(filename);
    } catch (err) {
      console.error('Error writing to cache', err);
    }
  }

  async read(filename: string) {
    if (this.invalidated.has(filename)) {
      return null;
    }

    let cacheFile = this.getCacheFile(filename);

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

  invalidate(filename: string) {
    this.invalidated.add(filename);
  }

  async delete(filename: string) {
    try {
      await fs.unlink(this.getCacheFile(filename));
      this.invalidated.delete(filename);
    } catch (err) {}
  }
}

module.exports = FSCache;
