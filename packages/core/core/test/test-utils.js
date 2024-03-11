// @flow strict-local

import type {ParcelOptions} from '../src/types';

import {FSCache} from '@parcel/cache';
import tempy from 'tempy';
import path from 'path';
import {inputFS, outputFS} from '@parcel/test-utils';
import {relativePath} from '@parcel/utils';
import {NodePackageManager} from '@parcel/package-manager';
import {createEnvironment} from '../src/Environment';
import {toProjectPath} from '../src/projectPath';
import {
  ParcelDb,
  type EnvironmentAddr,
  type TargetAddr,
  Target,
} from '@parcel/rust';

let cacheDir = tempy.directory();
export let cache: FSCache = new FSCache(outputFS, cacheDir);
cache.ensure();

export const DB: ParcelDb = ParcelDb.create({
  mode: 'development',
  env: {},
  log_level: 'info',
  project_root: __dirname,
});

export const DEFAULT_OPTIONS: ParcelOptions = {
  cacheDir: path.join(__dirname, '.parcel-cache'),
  watchDir: __dirname,
  entries: [],
  logLevel: 'info',
  targets: undefined,
  projectRoot: __dirname,
  shouldAutoInstall: false,
  hmrOptions: undefined,
  shouldContentHash: true,
  shouldBuildLazily: false,
  lazyIncludes: [],
  lazyExcludes: [],
  shouldBundleIncrementally: true,
  serveOptions: false,
  mode: 'development',
  env: {},
  shouldDisableCache: false,
  shouldProfile: false,
  shouldTrace: false,
  inputFS,
  outputFS,
  cache,
  shouldPatchConsole: false,
  packageManager: new NodePackageManager(inputFS, '/'),
  additionalReporters: [],
  instanceId: 'test',
  defaultTargetOptions: {
    shouldScopeHoist: false,
    shouldOptimize: false,
    publicUrl: '/',
    distDir: undefined,
    sourceMaps: false,
  },
  db: DB,
  featureFlags: {
    exampleFeature: false,
  },
};

export const DEFAULT_ENV: EnvironmentAddr = createEnvironment(DB, {
  context: 'browser',
  engines: {
    browsers: ['> 1%'],
  },
});

const target = new Target(DB);
target.env = DEFAULT_ENV;
target.distDir = toProjectPath('/', '/dist');
target.distEntry = 'out.js';
target.name = 'test';
target.publicUrl = '/';
target.loc = null;
target.pipeline = null;

export const DEFAULT_TARGETS: Array<TargetAddr> = [target.addr];

export function relative(f: string): string {
  return relativePath(__dirname, f, false);
}
