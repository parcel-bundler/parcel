import Module from 'module';
import process from 'process';
import path from 'path';
import fs from 'fs';

import Parcel, {Asset, createDependency} from '@parcel/core';
import Cache from '@parcel/cache';
import syncPromise from '@parcel/utils/lib/syncPromise';

let revert = null;
const originalRequire = Module.prototype.require;
const DEFAULT_CLI_OPTS = {
  watch: false
};

function readPkgUp(dir) {
  let dirContent = fs.readdirSync(dir);

  for (let filename of dirContent) {
    if (filename === 'package.json') {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
    }
  }

  if (dir === '/') {
    return null;
  }

  return readPkgUp(path.dirname(dir));
}

// The filehandler returns a function that transforms the code
function fileHandler({opts, parcel, cache, environment}) {
  // As Parcel is pretty much fully asynchronous, create an async function and return it wrapped in a syncPromise
  async function fileProcessor(code, filename) {
    try {
      let result = await parcel.runTransform({
        filePath: filename,
        env: environment
      });

      if (result.assets && result.assets.length >= 1) {
        let asset = new Asset({...result.assets[0], cache});
        let output = await asset.getOutput();

        return output.code;
      }
    } catch (e) {
      console.error('@parcel/register failed to process: ', filename);
      console.error(e);
    }

    return '';
  }

  return (...args) => syncPromise(fileProcessor(...args));
}

export default function register(opts = DEFAULT_CLI_OPTS) {
  // Replace old hook, as this one likely contains options.
  if (revert) {
    revert();
  }

  let parcel = new Parcel({
    entries: [path.join(process.cwd(), 'index.js')],
    cliOpts: opts
  });

  let cache = new Cache(opts);

  let environment = {
    context: 'node',
    engines: {
      node: process.versions.node
    }
  };

  Module.prototype.require = function(filePath, ...args) {
    let pkg = readPkgUp(path.dirname(this.filename));

    if (pkg.name.includes('@parcel') || pkg.name.includes('parcel')) {
      return originalRequire.bind(this)(filePath, ...args);
    }

    let dep = createDependency(
      {
        moduleSpecifier: filePath
      },
      this.filename
    );

    let resolved = syncPromise(parcel.resolverRunner.resolve(dep));

    return originalRequire.bind(this)(filePath, ...args);
  };
}

// Hook into require, this will be overwritten whenever it is called again or explicitly called with opts
register();
