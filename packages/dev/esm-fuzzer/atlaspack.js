import Atlaspack, {createWorkerFarm} from '@atlaspack/core';
import {NodeFS, MemoryFS, OverlayFS} from '@atlaspack/fs';
import path from 'path';

const DIST_DIR = path.join(__dirname, './dist');

module.exports = async function ({
  inputFS,
  entries,
  outputFormat = 'esmodule',
  externalModules,
}) {
  let outputFS = new MemoryFS(module.exports.workerFarm);

  await outputFS.mkdirp(DIST_DIR);

  let includeNodeModules = {};
  if (externalModules) {
    for (let m of externalModules) {
      includeNodeModules[m] = false;
    }
  }

  let b = new Atlaspack({
    entries,
    shouldDisableCache: true,
    defaultConfig: `${__dirname}/config.json`,
    inputFS: new OverlayFS(inputFS, new NodeFS()),
    outputFS: outputFS,
    workerFarm: module.exports.workerFarm,
    defaultTargetOptions: {
      distDir: DIST_DIR,
      shouldOptimize: false,
      engines: {
        browsers: ['Chrome 80'],
        node: '14',
      },
    },
    shouldPatchConsole: false,
    mode: 'production',
    targets: {
      default: {
        outputFormat,
        distDir: DIST_DIR,
        includeNodeModules,
        isLibrary: true,
        engines: {
          browsers: 'Chrome 80',
        },
      },
    },
  });

  await b.run();

  let output = new Map();
  for (let file of await outputFS.readdir(DIST_DIR)) {
    if (file.endsWith('.map')) continue;
    output.set(
      path.join(DIST_DIR, file),
      await outputFS.readFile(path.join(DIST_DIR, file), 'utf8'),
    );
  }
  return {distDir: DIST_DIR, output};
};

module.exports.start = function () {
  module.exports.workerFarm = createWorkerFarm();
};

module.exports.stop = async function () {
  await module.exports.workerFarm.end();
};
