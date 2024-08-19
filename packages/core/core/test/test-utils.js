// @flow strict-local

import type {Environment, AtlaspackOptions, Target} from '../src/types';

import {DEFAULT_FEATURE_FLAGS} from '@atlaspack/feature-flags';
import {FSCache} from '@atlaspack/cache';
import tempy from 'tempy';
import path from 'path';
import {inputFS, outputFS} from '@atlaspack/test-utils';
import {relativePath} from '@atlaspack/utils';
import {NodePackageManager} from '@atlaspack/package-manager';
import {createEnvironment} from '../src/Environment';
import {toProjectPath} from '../src/projectPath';

let cacheDir = tempy.directory();
export let cache: FSCache = new FSCache(outputFS, cacheDir);
cache.ensure();

export const DEFAULT_OPTIONS: AtlaspackOptions = {
  cacheDir: path.join(__dirname, '.atlaspack-cache'),
  atlaspackVersion: '',
  watchDir: __dirname,
  watchIgnore: undefined,
  watchBackend: undefined,
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
  featureFlags: {
    ...DEFAULT_FEATURE_FLAGS,
  },
};

export const DEFAULT_ENV: Environment = createEnvironment({
  context: 'browser',
  engines: {
    browsers: ['> 1%'],
  },
});

export const DEFAULT_TARGETS: Array<Target> = [
  {
    name: 'test',
    distDir: toProjectPath('/', '/dist'),
    distEntry: 'out.js',
    env: DEFAULT_ENV,
    publicUrl: '/',
  },
];

export function relative(f: string): string {
  return relativePath(__dirname, f, false);
}
