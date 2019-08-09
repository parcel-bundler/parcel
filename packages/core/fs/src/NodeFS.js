// @flow
import type {FileSystem} from './types';
import type {FilePath} from '@parcel/types';

import fs from 'fs';
import ncp from 'ncp';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import {registerSerializableClass, promisify} from '@parcel/utils';
import packageJSON from '../package.json';

// Most of this can go away once we only support Node 10+, which includes
// require('fs').promises

const realpath = promisify(fs.realpath);

export class NodeFS implements FileSystem {
  readFile = promisify(fs.readFile);
  writeFile = promisify(fs.writeFile);
  copyFile = promisify(fs.copyFile);
  stat = promisify(fs.stat);
  readdir = promisify(fs.readdir);
  unlink = promisify(fs.unlink);
  utimes = promisify(fs.utimes);
  mkdirp = promisify(mkdirp);
  rimraf = promisify(rimraf);
  ncp = promisify(ncp);
  createReadStream = fs.createReadStream;
  createWriteStream = fs.createWriteStream;
  cwd = process.cwd;

  async realpath(originalPath: string): Promise<string> {
    try {
      return realpath(originalPath, 'utf8');
    } catch (e) {
      // do nothing
    }

    return originalPath;
  }

  exists(filePath: FilePath): Promise<boolean> {
    return new Promise(resolve => {
      fs.exists(filePath, resolve);
    });
  }

  static deserialize() {
    return new NodeFS();
  }

  serialize() {
    return null;
  }
}

registerSerializableClass(`${packageJSON.version}:NodeFS`, NodeFS);
