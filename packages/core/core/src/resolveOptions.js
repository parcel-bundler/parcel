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
import {resolveConfig} from '@parcel/utils';

// Default cache directory name
const DEFAULT_CACHE_DIRNAME = '.parcel-cache';

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

  let projectRoot = path.dirname(
    (await resolveConfig(path.join(process.cwd(), 'index'), [
      'yarn.lock',
      'package-lock.json',
      'pnpm-lock.yaml',
      '.git',
      '.hg'
    ])) || path.join(process.cwd(), 'index')
  );

  let cacheDir =
    // If a cacheDir is provided, resolve it relative to cwd. Otherwise,
    // use a default directory resolved relative to the project root.
    initialOptions.cacheDir != null
      ? path.resolve(initialOptions.cacheDir)
      : path.resolve(projectRoot, DEFAULT_CACHE_DIRNAME);

  let targetResolver = new TargetResolver();
  let targets = await targetResolver.resolve(rootDir, cacheDir, initialOptions);

  if (!initialOptions.env) {
    await loadEnv(path.join(rootDir, 'index'));
  }

  // $FlowFixMe
  return {
    env: process.env,
    ...initialOptions,
    cacheDir,
    entries,
    rootDir,
    targets,
    scopeHoist:
      initialOptions.scopeHoist ?? initialOptions.mode === 'production',
    logLevel: initialOptions.logLevel ?? 'info',
    projectRoot
  };
}
