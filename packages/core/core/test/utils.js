// @flow
import type {ParcelOptions} from '../src/types';

import Cache, {createCacheDir} from '@parcel/cache';
import {inputFS, outputFS} from '@parcel/test-utils';
import {NodePackageManager} from '@parcel/package-manager';
import tempy from 'tempy';

let cacheDir = tempy.directory();
createCacheDir(outputFS, cacheDir);
export let cache = new Cache(outputFS, cacheDir);

export const DEFAULT_OPTIONS: ParcelOptions = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'info',
  rootDir: __dirname,
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
