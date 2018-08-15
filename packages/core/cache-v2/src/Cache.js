const fs = require('@parcel/fs');
const pkg = require('../package.json');
const Path = require('path');
const md5 = require('@parcel/utils/md5');
const objectHash = require('@parcel/utils/objectHash');
const logger = require('@parcel/logger');

// These keys can affect the output, so if they differ, the cache should not match
const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];

class Cache {
  constructor(options) {
    this.dir = Path.resolve(options.cacheDir || '.parcel-cache');
    this.dirExists = false;
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p, k) => ((p[k] = options[k]), p), {
        version: pkg.version
      })
    );
  }

  async ensureDirExists() {
    if (this.dirExists) {
      return;
    }

    await fs.mkdirp(this.dir);

    // Create sub-directories for every possible hex value
    // This speeds up large caches on many file systems since there are fewer files in a single directory.
    for (let i = 0; i < 256; i++) {
      await fs.mkdirp(Path.join(this.dir, ('00' + i.toString(16)).slice(-2)));
    }

    this.dirExists = true;
  }
  
  getCacheId(filePath) {
    return md5(this.optionsHash + filePath);
  }

  async getLastModified(filePath) {
    return (await fs.stat(filePath)).mtime.getTime();
  }

  async writeDepMtimes(asset) {
    // Write mtimes for each dependent file that is already compiled into this asset
    for (let dep of asset.dependencies) {
      if (dep.isIncluded) {
        dep.mtime = await this.getLastModified(dep.resolvedPath);
      }
    }
  }

  getCachePath(cacheId, extension = '.json') {
    return Path.join(this.dir, cacheId.slice(0, 2), cacheId.slice(2) + extension);
  }

  async writeCacheFile(cacheId, data) {
    let cacheFilePath = this.getCachePath(cacheId);
    await fs.writeFile(cacheFilePath, JSON.stringify(data));
    return cacheFilePath;
  }

  async writeBlob(type, cacheId, data) {
    let blobPath = this.getCachePath(cacheId, '.' + type);
    await fs.writeFile(blobPath, typeof data === 'object' ? JSON.stringify(data) : data);
    return blobPath;
  }

  async createCacheEntry(assets, cacheId) {
    let cacheEntry = {
      id: cacheId,
      subModules: assets
    };

    cacheEntry.subModules = await Promise.all(
      cacheEntry.subModules.map(async asset => {
        let assetCacheId = this.getCacheId(asset.filePath);

        asset.mtime = await this.getLastModified(asset.filePath);
        asset.code = await this.writeBlob(asset.type, assetCacheId, asset.code);
        if (asset.map) {
          asset.map = await this.writeBlob(asset.type + '.map', assetCacheId, asset.map);
        }

        await this.writeDepMtimes(asset);

        return asset;
      })
    );

    return cacheEntry;
  }

  async write(filePath, assets) {
    try {
      await this.ensureDirExists();
      let cacheId = this.getCacheId(filePath);
      let cacheEntry = await this.createCacheEntry(assets, cacheId);
      await this.writeCacheFile(cacheId, cacheEntry);
      this.invalidated.delete(filePath);
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }

  async checkDepMtimes(asset) {
    // Check mtimes for files that are already compiled into this asset
    // If any of them changed, invalidate.
    for (let dep of asset.dependencies) {
      if (dep.isIncluded) {
        if ((await this.getLastModified(dep.resolvedPath)) > dep.mtime) {
          return false;
        }
      }
    }

    return true;
  }

  async getCacheEntry(cacheId) {
    return JSON.parse(await fs.readFile(this.getCachePath(cacheId), 'utf-8'));
  }

  async reconstructCacheEntry(cacheEntry) {
    cacheEntry.subModules = await Promise.all(
      cacheEntry.subModules.map(async asset => {
        asset.mtime = await fs.readFile(asset.code, 'utf-8');
        asset.code = await fs.readFile(asset.code, 'utf-8');
        if (asset.map) {
          asset.map = await fs.readFile(asset.map, 'utf-8');
        }
        return asset;
      })
    );

    return cacheEntry;
  }

  async read(filePath) {
    if (this.invalidated.has(filePath)) {
      return null;
    }

    let cacheId = this.getCacheId(filePath);
    try {
      let stats = await fs.stat(filePath);
      let cachePath = this.getCachePath(cacheId);
      let cacheStats = await fs.stat(cachePath);

      if (stats.mtime > cacheStats.mtime) {
        return null;
      }

      let cacheEntry = await this.getCacheEntry(cacheId);
      for (let asset of cacheEntry.subModules) {
        let moduleStats = await fs.stat(asset.filePath);
        if (moduleStats.mtime > cacheStats.mtime || !(await this.checkDepMtimes(asset))) {
          return null;
        }
      }

      cacheEntry = await this.reconstructCacheEntry(cacheEntry);

      return cacheEntry;
    } catch (err) {
      return null;
    }
  }

  invalidate(filePath) {
    this.invalidated.add(filePath);
  }

  async delete(filePath) {
    try {
      let cacheId = this.getCacheId(filePath);
      await fs.unlink(this.getCachePath(cacheId));
      this.invalidated.delete(filePath);
    } catch (err) {
      // Fail silently
    }
  }
}

module.exports = Cache;