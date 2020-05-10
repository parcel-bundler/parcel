// @flow strict-local

import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import {isGlob} from './glob';

const path = require('path');

export default async function getRootDir(
  inputFS: FileSystem,
  entries: Array<FilePath>,
): Promise<FilePath> {
  let cur = null;

  for (let file of entries) {
    let parsed = path.parse(
      (await inputFS.stat(file)).isDirectory() ? `${file}/index` : file,
    );
    parsed.dir = findGlobRoot(parsed.dir);
    if (!cur) {
      cur = parsed;
    } else if (parsed.root !== cur.root) {
      // bail out. there is no common root.
      // this can happen on windows, e.g. C:\foo\bar vs. D:\foo\bar
      return process.cwd();
    } else {
      // find the common path parts.
      let curParts = cur.dir.split(path.sep);
      let newParts = parsed.dir.split(path.sep);
      let len = Math.min(curParts.length, newParts.length);
      let i = 0;
      while (i < len && curParts[i] === newParts[i]) {
        i++;
      }

      cur.dir = i > 1 ? curParts.slice(0, i).join(path.sep) : cur.root;
    }
  }

  return cur ? cur.dir : process.cwd();
}

// Transforms a path like `packages/*/src/index.js` to the root of the glob, `packages/`
function findGlobRoot(dir: FilePath) {
  let parts = dir.split(path.sep);
  let last = parts.length;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isGlob(parts[i])) {
      last = i;
    }
  }

  return parts.slice(0, last).join(path.sep);
}
