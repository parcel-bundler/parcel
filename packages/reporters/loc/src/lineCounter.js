// @flow

import type {Bundle} from '@parcel/types';

const path = require('path');
const fs = require('fs');
const {PromiseQueue} = require('@parcel/utils');
const os = require('os');
const util = require('util');
const exists = util.promisify(fs.exists);

const runtimesPath = path.resolve('../../runtimes');

const lineCounter = async (bundles: Array<Bundle>) => {
  let set = new Set();

  for (let bundle of bundles) {
    bundle.traverseAssets(asset => {
      let {filePath} = asset;

      if (filePath != null && !filePath.startsWith(runtimesPath)) {
        set.add(filePath);
      }
    });
  }

  let queue = new PromiseQueue({maxConcurrent: os.cpus().length});
  let lineCount = 0;
  for (let assetPath of set) {
    queue
      .add(() => countLinesInFile(assetPath))
      .then(count => (lineCount += count));
  }

  await queue.run();
  return lineCount;
};

const NEWLINE_CHAR = 10;
const NULL_BYTE = 0; // Only appears in binary files
const countLinesInFile = async filePath => {
  // Parcel sometimes assigns filePaths to assets that don't exist
  if (!(await exists(filePath))) {
    return 0;
  }

  return new Promise((resolve, reject) => {
    let lineCount = 0;
    let isBinary;

    let stream = fs
      .createReadStream(filePath)
      .on('data', (buf: Buffer) => {
        let i = -1;
        lineCount--;

        if (buf.includes(NULL_BYTE)) {
          isBinary = true;
          stream.destroy();
          resolve(0);
          return;
        }

        do {
          i = buf.indexOf(NEWLINE_CHAR, i + 1);
          lineCount++;
        } while (i !== -1);
      })
      .on('end', () => {
        resolve(lineCount);
      })
      .on('error', reject);
  });
};

export default lineCounter;
