// @flow strict-local

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
  shouldAutoInstall: false,
  hmrOptions: undefined,
  shouldContentHash: true,
  serveOptions: false,
  mode: 'development',
  env: {},
  shouldDisableCache: false,
  shouldProfile: false,
  inputFS,
  outputFS,
  cache,
  shouldPatchConsole: false,
  packageManager: new NodePackageManager(inputFS),
  instanceId: 'test',
  defaultTargetOptions: {
    shouldScopeHoist: false,
    shouldOptimize: false,
    publicUrl: '/',
    distDir: undefined,
    sourceMaps: false,
  },
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
