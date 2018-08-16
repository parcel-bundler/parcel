// @flow
'use strict';

const { packager } = require('@parcel/plugin');
const fs = require('fs');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

module.exports = packager({
  // async readFile(opts) {
  //   return await readFile(opts.filePath, 'utf-8');
  // },

  async writeFile(opts) {
    await writeFile(opts.filePath, opts.fileContents);
  },

  async asset(asset) {
    return '// module intro\n' + asset.blobs.code + '// module outro\n';
  },

  async package(contents) {
    return '// package intro\n' + contents.join('\n') + '// package outro\n';
  },
});
