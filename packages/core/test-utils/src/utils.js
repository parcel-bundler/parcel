// @flow

import type {
  BuildEvent,
  BundleGraph,
  FilePath,
  InitialParcelOptions
} from '@parcel/types';

import invariant from 'assert';
import Parcel from '@parcel/core';
import defaultConfigContents from '@parcel/config-default';
import assert from 'assert';
import vm from 'vm';
import {NodeFS, MemoryFS} from '@parcel/fs';
import path from 'path';
import WebSocket from 'ws';
import nullthrows from 'nullthrows';

import {promisify, syncPromise} from '@parcel/utils';
import _ncp from 'ncp';
import _chalk from 'chalk';
import resolve from 'resolve';

export const inputFS = new NodeFS();
export const outputFS = new MemoryFS();
export const ncp = promisify(_ncp);

export const defaultConfig = {
  ...defaultConfigContents,
  filePath: require.resolve('@parcel/config-default'),
  reporters: []
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

export const distDir = path.resolve(
  __dirname,
  '..',
  '..',
  'integration-tests',
  'dist'
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
-----------------------------------`
  );
}

export function bundler(
  entries: FilePath | Array<FilePath>,
  opts: InitialParcelOptions
) {
  return new Parcel({
    entries,
    cache: false,
    logLevel: 'none',
    killWorkers: false,
    defaultConfig,
    inputFS,
    outputFS,
    ...opts
  });
}

export async function bundle(
  entries: FilePath | Array<FilePath>,
  opts: InitialParcelOptions
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
  opts: {require?: boolean} = {}
): Promise<mixed> {
  let bundles = [];
  bundleGraph.traverseBundles(bundle => {
    bundles.push(bundle);
  });

  let bundle = nullthrows(bundles.find(b => b.isEntry));
  let entryAsset = bundle.getEntryAssets()[0];
  let target = entryAsset.env.context;

  var ctx;
  switch (target) {
    case 'browser':
      ctx = prepareBrowserContext(nullthrows(bundle.filePath), globals);
      break;
    case 'node':
      ctx = prepareNodeContext(nullthrows(bundle.filePath), globals);
      break;
    case 'electron':
      ctx = Object.assign(
        prepareBrowserContext(nullthrows(bundle.filePath), globals),
        prepareNodeContext(nullthrows(bundle.filePath), globals)
      );
      break;
    default:
      throw new Error('Unknown target ' + target);
  }

  vm.createContext(ctx);
  vm.runInContext(
    await outputFS.readFile(nullthrows(bundle.filePath), 'utf8'),
    ctx
  );

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

export async function assertBundles(
  bundleGraph: BundleGraph,
  bundles: Array<{|
    name?: string | RegExp,
    type?: string,
    assets?: Array<string>
  |}>
) {
  let actualBundles = [];
  bundleGraph.traverseBundles(bundle => {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(path.basename(asset.filePath));
    });

    assets.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    actualBundles.push({
      name: path.basename(nullthrows(bundle.filePath)),
      type: bundle.type,
      assets
    });
  });

  for (let bundle of bundles) {
    // $FlowFixMe
    bundle.assets.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  }

  // $FlowFixMe
  bundles.sort((a, b) => (a.assets[0] < b.assets[0] ? -1 : 1));
  actualBundles.sort((a, b) => (a.assets[0] < b.assets[0] ? -1 : 1));
  assert.equal(
    actualBundles.length,
    bundles.length,
    'expected number of bundles mismatched'
  );

  let i = 0;
  for (let bundle of bundles) {
    let actualBundle = actualBundles[i++];
    let name = bundle.name;
    if (name) {
      if (typeof name === 'string') {
        assert.equal(actualBundle.name, name);
      } else if (name instanceof RegExp) {
        assert(
          actualBundle.name.match(name),
          `${actualBundle.name} does not match regexp ${name.toString()}`
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

    // assert(await fs.exists(bundle.filePath), 'expected file does not exist');
  }
}

export function normaliseNewlines(text: string): string {
  return text.replace(/(\r\n|\n|\r)/g, '\n');
}

function prepareBrowserContext(filePath: FilePath, globals: mixed): vm$Context {
  // for testing dynamic imports
  const fakeElement = {
    remove() {}
  };

  const fakeDocument = {
    createElement(tag) {
      return {tag};
    },

    getElementsByTagName() {
      return [
        {
          appendChild(el) {
            setTimeout(function() {
              if (el.tag === 'script') {
                vm.runInContext(
                  syncPromise(
                    outputFS.readFile(
                      path.join(path.dirname(filePath), el.src),
                      'utf8'
                    )
                  ),
                  ctx
                );
              }

              el.onload();
            }, 0);
          }
        }
      ];
    },

    getElementById() {
      return fakeElement;
    },

    body: {
      appendChild() {
        return null;
      }
    }
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
            return new Uint8Array(
              await outputFS.readFile(path.join(path.dirname(filePath), url))
            ).buffer;
          },
          async text() {
            return outputFS.readFile(
              path.join(path.dirname(filePath), url),
              'utf8'
            );
          }
        });
      }
    },
    globals
  );

  ctx.window = ctx;
  return ctx;
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
        return syncPromise(outputFS.readFile(...args));
      },
      isFile: file => {
        try {
          var stat = syncPromise(outputFS.stat(file));
        } catch (err) {
          return false;
        }
        return stat.isFile();
      },
      isDirectory: file => {
        try {
          var stat = syncPromise(outputFS.stat(file));
        } catch (err) {
          return false;
        }
        return stat.isDirectory();
      }
    });

    // Shim FS module using outputFS
    if (res === 'fs') {
      return {
        readFile: async (file, encoding, cb) => {
          let res = await outputFS.readFile(file, encoding);
          cb(null, res);
        },
        readFileSync: (file, encoding) => {
          return syncPromise(outputFS.readFile(file, encoding));
        }
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
    vm.runInContext(syncPromise(outputFS.readFile(res, 'utf8')), ctx);
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
      setImmediate: setImmediate
    },
    globals
  );

  ctx.global = ctx;
  return ctx;
}
