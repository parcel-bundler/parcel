// @flow strict-local

import type {
  FilePath,
  InitialParcelOptions,
  ParcelOptions
} from '@parcel/types';

import {getRootDir} from '@parcel/utils';
import loadEnv from './loadEnv';
import path from 'path';
import TargetResolver from './TargetResolver';

// Default cache directory name
const DEFAULT_CACHE_DIR = '.parcel-cache';

export default async function resolveOptions(
  initialOptions: InitialParcelOptions
): Promise<ParcelOptions> {
  let entries: Array<FilePath>;
  if (initialOptions.entries == null || initialOptions.entries === '') {
    entries = [];
  } else if (Array.isArray(initialOptions.entries)) {
    entries = initialOptions.entries;
  } else {
    entries = [initialOptions.entries];
  }

  let rootDir =
    initialOptions.rootDir != null
      ? initialOptions.rootDir
      : getRootDir(entries);

  let targetResolver = new TargetResolver();
  let targets = await targetResolver.resolve(rootDir, initialOptions);

  if (!initialOptions.env) {
    await loadEnv(path.join(rootDir, 'index'));
  }

  // $FlowFixMe
  return {
    env: process.env,
    ...initialOptions,
    cacheDir:
      initialOptions.cacheDir != null
        ? initialOptions.cacheDir
        : DEFAULT_CACHE_DIR,
    entries,
    rootDir,
    targets,
    logLevel: initialOptions.logLevel != null ? initialOptions.logLevel : 'info'
  };
}
