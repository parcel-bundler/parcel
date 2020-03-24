// @flow

import type {
  BuildEvent,
  BundleGraph,
  FilePath,
  InitialParcelOptions,
} from '@parcel/types';

import invariant from 'assert';
import Parcel, {createWorkerFarm} from '@parcel/core';
import defaultConfigContents from '@parcel/config-default';
import assert from 'assert';
import vm from 'vm';
import {NodeFS, MemoryFS, OverlayFS, ncp as _ncp} from '@parcel/fs';
import path from 'path';
import WebSocket from 'ws';
import nullthrows from 'nullthrows';

import {makeDeferredWithPromise} from '@parcel/utils';
import _chalk from 'chalk';
import resolve from 'resolve';
import {NodePackageManager} from '@parcel/package-manager';

const workerFarm = createWorkerFarm();
export const inputFS = new NodeFS();
export let outputFS = new MemoryFS(workerFarm);
export let overlayFS = new OverlayFS(outputFS, inputFS);

beforeEach(() => {
  outputFS = new MemoryFS(workerFarm);
  overlayFS = new OverlayFS(outputFS, inputFS);
});

// Recursively copies a directory from the inputFS to the outputFS
export async function ncp(source: FilePath, destination: FilePath) {
  await _ncp(inputFS, source, outputFS, destination);
}

// Mocha is currently run with exit: true because of this issue preventing us
// from properly ending the workerfarm after the test run:
// https://github.com/nodejs/node/pull/28788
//
// TODO: Remove exit: true in .mocharc.json and instead add the following in this file:
//   // Spin down the worker farm to stop it from preventing the main process from exiting
//   await workerFarm.end();
// when https://github.com/nodejs/node/pull/28788 is resolved.

export const defaultConfig = {
  ...defaultConfigContents,
  filePath: require.resolve('@parcel/config-default'),
  reporters: [],
};

const chalk = new _chalk.constructor({enabled: true});
const warning = chalk.keyword('orange');

/* eslint-disable no-console */
// $FlowFixMe
console.warn = (...args) => {
  // eslint-disable-next-line no-console
  console.error(warning(...args));
};
/* eslint-enable no-console */

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeFilePath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/');
}

export const distDir = path.resolve(
  __dirname,
  '..',
  '..',
  'integration-tests',
  'dist',
);

export async function removeDistDirectory() {
  await outputFS.rimraf(distDir);
}

export function symlinkPrivilegeWarning() {
  // eslint-disable-next-line no-console
  console.warn(
    `-----------------------------------
Skipping symbolic link test(s) because you don't have the privilege.
Run tests with Administrator privilege.
If you don't know how, check here: https://bit.ly/2UmWsbD
-----------------------------------`,
  );
}

export function bundler(
  entries: FilePath | Array<FilePath>,
  opts?: InitialParcelOptions,
) {
  return new Parcel({
    entries,
    disableCache: true,
    logLevel: 'none',
    defaultConfig,
    inputFS,
    outputFS,
    workerFarm,
    packageManager: new NodePackageManager(inputFS),
    defaultEngines: {
      browsers: ['last 1 Chrome version'],
      node: '8',
    },
    ...opts,
  });
}

export async function bundle(
  entries: FilePath | Array<FilePath>,
  opts?: InitialParcelOptions,
): Promise<BundleGraph> {
  return nullthrows(await bundler(entries, opts).run());
}

export function getNextBuild(b: Parcel): Promise<BuildEvent> {
  return new Promise((resolve, reject) => {
    let subscriptionPromise = b
      .watch((err, buildEvent) => {
        if (err) {
          reject(err);
          return;
        }

        subscriptionPromise
          .then(subscription => {
            // If the watch callback was reached, subscription must have been successful
            invariant(subscription != null);
            return subscription.unsubscribe();
          })
          .then(() => {
            // If the build promise hasn't been rejected, buildEvent must exist
            invariant(buildEvent != null);
            resolve(buildEvent);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

export async function run(
  bundleGraph: BundleGraph,
  globals: mixed,
  opts: {require?: boolean, ...} = {},
): Promise<mixed> {
  let bundles = bundleGraph.getBundles();

  let bundle = nullthrows(bundles.find(b => b.type === 'js'));
  let entryAsset = nullthrows(bundle.getMainEntry());
  let target = entryAsset.env.context;

  let ctx, promises;
  switch (target) {
    case 'browser': {
      let prepared = prepareBrowserContext(
        nullthrows(bundle.filePath),
        globals,
      );
      ctx = prepared.ctx;
      promises = prepared.promises;
      break;
    }
    case 'node':
    case 'electron-main':
      ctx = prepareNodeContext(nullthrows(bundle.filePath), globals);
      break;
    case 'electron-renderer': {
      let browser = prepareBrowserContext(nullthrows(bundle.filePath), globals);
      ctx = {
        ...browser.ctx,
        ...prepareNodeContext(nullthrows(bundle.filePath), globals),
      };
      promises = browser.promises;
      break;
    }
    default:
      throw new Error('Unknown target ' + target);
  }

  vm.createContext(ctx);
  vm.runInContext(
    await overlayFS.readFile(nullthrows(bundle.filePath), 'utf8'),
    ctx,
  );

  if (promises) {
    // await any ongoing dynamic imports during the run
    await Promise.all(promises);
  }

  if (opts.require !== false) {
    if (ctx.parcelRequire) {
      // $FlowFixMe
      return ctx.parcelRequire(entryAsset.id);
    } else if (ctx.output) {
      return ctx.output;
    }
    if (ctx.module) {
      // $FlowFixMe
      return ctx.module.exports;
    }
  }

  return ctx;
}

export function assertBundles(
  bundleGraph: BundleGraph,
  expectedBundles: Array<{|
    name?: string | RegExp,
    type?: string,
    assets: Array<string>,
    includedFiles?: {
      [key: string]: Array<string>,
      ...,
    },
  |}>,
) {
  let actualBundles = [];
  const byAlphabet = (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1);

  bundleGraph.traverseBundles(bundle => {
    let assets = [];
    const includedFiles = {};

    bundle.traverseAssets(asset => {
      const name = path.basename(asset.filePath);
      assets.push(name);
      includedFiles[name] = asset
        .getIncludedFiles()
        .map(({filePath}) => path.basename(filePath))
        .sort(byAlphabet);
    });

    assets.sort(byAlphabet);
    actualBundles.push({
      name: path.basename(nullthrows(bundle.filePath)),
      type: bundle.type,
      assets,
      includedFiles,
    });
  });

  for (let bundle of expectedBundles) {
    if (!Array.isArray(bundle.assets)) {
      throw new Error(
        'Expected bundle must include an array of expected assets',
      );
    }
    bundle.assets.sort(byAlphabet);
  }

  const byName = (a, b) => {
    if (typeof a.name === 'string' && typeof b.name === 'string') {
      return a.name.localeCompare(b.name);
    }

    return 0;
  };

  const byAssets = (a, b) => a.assets[0].localeCompare(b.assets[0]);
  expectedBundles.sort(byName).sort(byAssets);
  actualBundles.sort(byName).sort(byAssets);
  assert.equal(
    actualBundles.length,
    expectedBundles.length,
    'expected number of bundles mismatched',
  );

  let i = 0;
  for (let bundle of expectedBundles) {
    let actualBundle = actualBundles[i++];
    let name = bundle.name;
    if (name) {
      if (typeof name === 'string') {
        assert.equal(actualBundle.name, name);
      } else if (name instanceof RegExp) {
        assert(
          actualBundle.name.match(name),
          `${actualBundle.name} does not match regexp ${name.toString()}`,
        );
      } else {
        // $FlowFixMe
        assert.fail();
      }
    }

    if (bundle.type) {
      assert.equal(actualBundle.type, bundle.type);
    }

    if (bundle.assets) {
      assert.deepEqual(actualBundle.assets, bundle.assets);
    }

    if (bundle.includedFiles) {
      for (let asset of actualBundle.assets) {
        const files = bundle.includedFiles[asset];
        if (!files) {
          continue;
        }
        assert.deepEqual(
          actualBundle.includedFiles[asset],
          files.sort(byAlphabet),
        );
      }
    }
  }
}

export function normaliseNewlines(text: string): string {
  return text.replace(/(\r\n|\n|\r)/g, '\n');
}

function prepareBrowserContext(
  filePath: FilePath,
  globals: mixed,
): {|ctx: vm$Context, promises: Array<Promise<mixed>>|} {
  // for testing dynamic imports
  const fakeElement = {
    remove() {},
  };

  let promises = [];

  const fakeDocument = {
    createElement(tag) {
      return {tag};
    },

    getElementsByTagName() {
      return [
        {
          appendChild(el) {
            let {deferred, promise} = makeDeferredWithPromise();
            promises.push(promise);
            setTimeout(function() {
              if (el.tag === 'script') {
                vm.runInContext(
                  overlayFS.readFileSync(
                    path.join(path.dirname(filePath), el.src),
                    'utf8',
                  ),
                  ctx,
                );
              }

              el.onload();
              deferred.resolve();
            }, 0);
          },
        },
      ];
    },

    getElementById() {
      return fakeElement;
    },

    body: {
      appendChild() {
        return null;
      },
    },
  };

  var exports = {};
  var ctx = Object.assign(
    {
      exports,
      module: {exports},
      document: fakeDocument,
      WebSocket,
      console,
      location: {hostname: 'localhost'},
      fetch(url) {
        return Promise.resolve({
          async arrayBuffer() {
            let readFilePromise = overlayFS.readFile(
              path.join(path.dirname(filePath), url),
            );
            promises.push(readFilePromise);
            return new Uint8Array(await readFilePromise).buffer;
          },
          text() {
            let readFilePromise = overlayFS.readFile(
              path.join(path.dirname(filePath), url),
              'utf8',
            );
            promises.push(readFilePromise);
            return readFilePromise;
          },
        });
      },
      atob(str) {
        return Buffer.from(str, 'base64').toString('binary');
      },
    },
    globals,
  );

  ctx.window = ctx;
  return {ctx, promises};
}

const nodeCache = {};
function prepareNodeContext(filePath, globals) {
  let exports = {};
  let req = specifier => {
    // $FlowFixMe
    let res = resolve.sync(specifier, {
      basedir: path.dirname(filePath),
      preserveSymlinks: true,
      extensions: ['.js', '.json'],
      readFileSync: (...args) => {
        return overlayFS.readFileSync(...args);
      },
      isFile: file => {
        try {
          var stat = overlayFS.statSync(file);
        } catch (err) {
          return false;
        }
        return stat.isFile();
      },
      isDirectory: file => {
        try {
          var stat = overlayFS.statSync(file);
        } catch (err) {
          return false;
        }
        return stat.isDirectory();
      },
    });

    // Shim FS module using overlayFS
    if (res === 'fs') {
      return {
        readFile: async (file, encoding, cb) => {
          let res = await overlayFS.readFile(file, encoding);
          cb(null, res);
        },
        readFileSync: (file, encoding) => {
          return overlayFS.readFileSync(file, encoding);
        },
      };
    }

    if (res === specifier) {
      return require(specifier);
    }

    if (nodeCache[res]) {
      return nodeCache[res].module.exports;
    }

    let ctx = prepareNodeContext(res, globals);
    nodeCache[res] = ctx;

    vm.createContext(ctx);
    vm.runInContext(overlayFS.readFileSync(res, 'utf8'), ctx);
    return ctx.module.exports;
  };

  var ctx = Object.assign(
    {
      module: {exports, require: req},
      exports,
      __filename: filePath,
      __dirname: path.dirname(filePath),
      require: req,
      console,
      process: process,
      setTimeout: setTimeout,
      setImmediate: setImmediate,
    },
    globals,
  );

  ctx.global = ctx;
  return ctx;
}
