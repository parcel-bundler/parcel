// @flow strict-local

import type {FilePath} from '@parcel/types';

const path = require('path');

export default function getRootDir(files: Array<FilePath>): FilePath {
  let cur = null;

  for (let file of files) {
    let parsed = path.parse(file);
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
