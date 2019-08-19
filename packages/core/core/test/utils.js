// @flow
import type {ParcelOptions} from '../src/types';
import Cache, {createCacheDir, FSCache} from '@parcel/cache';
import tempy from 'tempy';
import {inputFS, outputFS} from '@parcel/test-utils';

let cacheDir = tempy.directory();
createCacheDir(outputFS, cacheDir);
export let cache = new Cache([new FSCache(outputFS, cacheDir)]);

export const DEFAULT_OPTIONS: ParcelOptions = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'info',
  rootDir: __dirname,
  targets: [],
  projectRoot: '',
  lockFile: undefined,
  autoinstall: false,
  hot: false,
  serve: false,
  mode: 'development',
  scopeHoist: false,
  minify: false,
  env: {},
  disableCache: false,
  sourceMaps: false,
  profile: false,
  inputFS,
  outputFS,
  cache
};
