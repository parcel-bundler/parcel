// @flow

import type {
  BundleGraph,
  Bundle,
  FilePath,
  InitialParcelOptions
} from '@parcel/types';

import Parcel from '@parcel/core';
import defaultConfigContents from '@parcel/config-default';
import assert from 'assert';
import vm from 'vm';
import * as fs from '@parcel/fs';
import nodeFS from 'fs';
import path from 'path';
import WebSocket from 'ws';
// $FlowFixMe
import Module from 'module';
import nullthrows from 'nullthrows';

import {promisify} from '@parcel/utils';
import _ncp from 'ncp';
import _chalk from 'chalk';

export const ncp = promisify(_ncp);

const defaultConfig = {
  ...defaultConfigContents,
  filePath: require.resolve('@parcel/config-default')
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

export async function removeDistDirectory(count: number = 0) {
  try {
    await fs.rimraf(distDir);
  } catch (e) {
    if (count > 8) {
      // eslint-disable-next-line no-console
      console.warn('WARNING: Unable to remove dist directory:', e.message);
      return;
    }

    await sleep(250);
    await removeDistDirectory(count + 1);
  }
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
    ...opts
  });
}

export async function bundle(
  entries: FilePath | Array<FilePath>,
  opts: InitialParcelOptions
): Promise<BundleGraph> {
  return nullthrows(await bundler(entries, opts).run());
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
      ctx = prepareBrowserContext(bundle, globals);
      break;
    case 'node':
      ctx = prepareNodeContext(bundle, globals);
      break;
    case 'electron':
      ctx = Object.assign(
        prepareBrowserContext(bundle, globals),
        prepareNodeContext(bundle, globals)
      );
      break;
    default:
      throw new Error('Unknown target ' + target);
  }

  vm.createContext(ctx);
  vm.runInContext(await fs.readFile(nullthrows(bundle.filePath), 'utf8'), ctx);

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

function prepareBrowserContext(bundle: Bundle, globals: mixed): vm$Context {
  let filePath = nullthrows(bundle.filePath);
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
                  nodeFS.readFileSync(
                    path.join(path.dirname(filePath), el.src),
                    'utf8'
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
          arrayBuffer() {
            return Promise.resolve(
              new Uint8Array(
                nodeFS.readFileSync(path.join(path.dirname(filePath), url))
              ).buffer
            );
          },
          text() {
            return Promise.resolve(
              nodeFS.readFileSync(
                path.join(path.dirname(filePath), url),
                'utf8'
              )
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

function prepareNodeContext(bundle, globals) {
  let filePath = nullthrows(bundle.filePath);
  var mod = new Module(filePath);
  mod.paths = [path.dirname(filePath) + '/node_modules'];

  var ctx = Object.assign(
    {
      module: mod,
      exports: module.exports,
      __filename: filePath,
      __dirname: path.dirname(filePath),
      require: function(path) {
        return mod.require(path);
      },
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
