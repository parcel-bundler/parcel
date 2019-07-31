// @flow
import type {FilePath} from '@parcel/types';
import type {Stats} from 'fs';
import type {Readable, Writable} from 'stream';

export type FileOptions = {
  mode?: number
};

export interface FileSystem {
  readFile(filePath: FilePath): Promise<Buffer>;
  readFile(filePath: FilePath, encoding?: buffer$Encoding): Promise<string>;
  writeFile(
    filePath: FilePath,
    contents: Buffer | string,
    options: ?FileOptions
  ): Promise<void>;
  copyFile(
    source: FilePath,
    destination: FilePath,
    flags?: number
  ): Promise<void>;
  stat(filePath: FilePath): Promise<$Shape<Stats>>;
  readdir(path: FilePath): Promise<FilePath[]>;
  unlink(path: FilePath): Promise<void>;
  realpath(path: FilePath): Promise<FilePath>;
  exists(path: FilePath): Promise<boolean>;
  mkdirp(path: FilePath): Promise<void>;
  rimraf(path: FilePath): Promise<void>;
  ncp(source: FilePath, destination: FilePath): Promise<void>;
  createReadStream(path: FilePath): Readable;
  createWriteStream(path: FilePath, options: ?FileOptions): Writable;
  cwd(): FilePath;
}
