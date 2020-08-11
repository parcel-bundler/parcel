// @flow

import type {Environment, ParcelOptions} from '../src/types';

import Cache, {createCacheDir} from '@parcel/cache';
import tempy from 'tempy';
import {inputFS, outputFS} from '@parcel/test-utils';
import {NodePackageManager} from '@parcel/package-manager';
import {createEnvironment} from '../src/Environment';

let cacheDir = tempy.directory();
createCacheDir(outputFS, cacheDir);
export let cache: Cache = new Cache(outputFS, cacheDir);

export const DEFAULT_OPTIONS: ParcelOptions = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'info',
  entryRoot: __dirname,
  targets: undefined,
  projectRoot: '',
  lockFile: undefined,
  autoinstall: false,
  hot: undefined,
  contentHash: true,
  serve: false,
  mode: 'development',
  scopeHoist: false,
  minify: false,
  publicUrl: '/',
  distDir: undefined,
  env: {},
  disableCache: false,
  sourceMaps: false,
  profile: false,
  inputFS,
  outputFS,
  cache,
  patchConsole: false,
  packageManager: new NodePackageManager(inputFS),
  instanceId: 'test',
};

export const DEFAULT_ENV: Environment = createEnvironment({
  context: 'browser',
  engines: {
    browsers: ['> 1%'],
  },
});

export const DEFAULT_TARGETS = [
  {
    name: 'test',
    distDir: 'dist',
    distEntry: 'out.js',
    env: DEFAULT_ENV,
    publicUrl: '/',
  },
];
