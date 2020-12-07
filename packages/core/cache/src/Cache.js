// @flow strict-local

import type {Readable} from 'stream';
import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import path from 'path';
import logger from '@parcel/logger';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {glob} from '@parcel/utils';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';

type CacheOptions = {|
  fs: FileSystem,
  cacheDir: FilePath,
  optionsHash: string,
|};

export default class Cache {
  fs: FileSystem;
  dir: FilePath;
  optionsHash: string;
  accessedFiles: Set<string>;

  constructor(options: CacheOptions) {
    this.fs = options.fs;
    this.dir = options.cacheDir;
    this.optionsHash = options.optionsHash;
    this.accessedFiles = new Set();
  }

  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    let cacheFile = `${cacheId.slice(0, 2)}/${cacheId.slice(2) + extension}`;
    this.accessedFiles.add(cacheFile);
    return path.join(this.dir, cacheFile);
  }

  getStream(key: string): Readable {
    return this.fs.createReadStream(this._getCachePath(key, '.blob'));
  }

  setStream(key: string, stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      stream
        .pipe(this.fs.createWriteStream(this._getCachePath(key, '.blob')))
        .on('error', reject)
        .on('finish', () => resolve(key));
    });
  }

  blobExists(key: string): Promise<boolean> {
    return this.fs.exists(this._getCachePath(key, '.blob'));
  }

  getBlob<T>(key: string, encoding?: buffer$Encoding): Promise<?T> {
    // $FlowFixMe
    return this.fs.readFile(this._getCachePath(key, '.blob'), encoding);
  }

  async setBlob(key: string, contents: Buffer | string): Promise<string> {
    await this.fs.writeFile(this._getCachePath(key, '.blob'), contents);
    return key;
  }

  async get<T>(key: string): Promise<?T> {
    try {
      let data = await this.fs.readFile(this._getCachePath(key));
      return deserialize(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      } else {
        throw err;
      }
    }
  }

  async set(key: string, value: mixed): Promise<?string> {
    try {
      let blobPath = this._getCachePath(key);
      let data = serialize(value);

      await this.fs.writeFile(blobPath, data);
      return key;
    } catch (err) {
      logger.error(err, '@parcel/cache');
    }
  }

  // Persist the cache to disk and/or write a manifest of all accessed files for cleaning...
  async persist() {
    let manifestPath = path.join(this.dir, 'manifest', `${Date.now()}.txt`);
    await this.fs.writeFile(
      manifestPath,
      Array.from(this.accessedFiles).join('\n'),
      'utf-8',
    );
  }

  // Persist the cache to disk and/or write a manifest of all accessed files for cleaning...
  async clean(maxAge: number = 604800000) {
    let manifestFiles = await glob(
      path.join(this.dir, 'manifest/*.txt'),
      this.fs,
      {
        absolute: true,
        onlyFiles: true,
      },
    );

    let removeManifestsModifiedBefore = Date.now() - maxAge;
    let filesToKeep = new Set();
    for (let manifestFile of manifestFiles) {
      let manifestStats = await this.fs.stat(manifestFile);

      if (manifestStats.mtimeMs > removeManifestsModifiedBefore) {
        let fileContent = await this.fs.readFile(manifestFile, 'utf-8');
        for (let fileEntry of fileContent.split('\n')) {
          filesToKeep.add(path.join(this.dir, fileEntry));
        }
        filesToKeep.add(manifestFile);
      } else {
        await this.fs.unlink(manifestFile);
      }
    }

    let cacheFiles = await glob(path.join(this.dir, '**/**'), this.fs, {
      absolute: true,
      onlyFiles: true,
    });
    for (let cacheFile of cacheFiles) {
      if (!filesToKeep.has(cacheFile)) {
        await this.fs.unlink(cacheFile);
        console.log('remove', cacheFile);
      }
    }
  }
}

export async function createCacheDir(
  fs: FileSystem,
  dir: FilePath,
): Promise<void> {
  // First, create the main cache directory if necessary.
  await fs.mkdirp(dir);

  await fs.mkdirp(path.join(dir, 'manifest'));

  // In parallel, create sub-directories for every possible hex value
  // This speeds up large caches on many file systems since there are fewer files in a single directory.
  let dirPromises = [];
  for (let i = 0; i < 256; i++) {
    dirPromises.push(
      fs.mkdirp(path.join(dir, ('00' + i.toString(16)).slice(-2))),
    );
  }

  await Promise.all(dirPromises);
}

registerSerializableClass(`${packageJson.version}:Cache`, Cache);
