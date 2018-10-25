// @flow
'use strict';

import {packager} from '@parcel/plugin';
import fs from 'fs';
import {promisify} from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export default packager({
  async readFile(opts) {
    return await readFile(opts.filePath, 'utf-8');
  },

  async writeFile(opts) {
    await writeFile(opts.filePath, opts.fileContents);
  },

  async asset(asset) {
    return '// module intro\n' + asset.blobs.code + '// module outro\n';
  },

  async package(contents) {
    return '// package intro\n' + contents.join('\n') + '// package outro\n';
  }
});
