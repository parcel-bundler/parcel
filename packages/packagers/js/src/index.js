// @flow
'use strict';

const { packager } = require('@parcel/plugin');
const fs = require('fs');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

module.exports = packager({
  async readFile(opts) {
    return await readFile(opts.filePath, 'utf-8');
  },

  async writeFile(opts) {
    await writeFile(opts.filePath, opts.fileContents);
  },

  async asset(opts) {
    return '// module intro\n' + opts.fileContents + '// module outro\n';
  },

  async package(opts) {
    return '// package intro\n' + opts.contents.join('\n') + '// package outro\n';
  },
});
