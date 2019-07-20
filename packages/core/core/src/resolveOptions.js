// @flow strict-local

import type {
  FilePath,
  InitialParcelOptions,
  ParcelOptions
} from '@parcel/types';

import {getRootDir} from '@parcel/utils';
import loadDotEnv from './loadDotEnv';
import path from 'path';
import TargetResolver from './TargetResolver';
import {resolveConfig} from '@parcel/utils';
import {NodeFS} from '@parcel/fs';

// Default cache directory name
const DEFAULT_CACHE_DIRNAME = '.parcel-cache';
const LOCK_FILE_NAMES = ['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml'];

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

  let inputFS = initialOptions.inputFS || new NodeFS();
  let outputFS = initialOptions.outputFS || new NodeFS();

  let rootDir =
    initialOptions.rootDir != null
      ? initialOptions.rootDir
      : getRootDir(entries);

  let projectRootFile =
    (await resolveConfig(inputFS, path.join(inputFS.cwd(), 'index'), [
      ...LOCK_FILE_NAMES,
      '.git',
      '.hg'
    ])) || path.join(inputFS.cwd(), 'index');

  let lockFile = null;
  let rootFileName = path.basename(projectRootFile);
  if (LOCK_FILE_NAMES.includes(rootFileName)) {
    lockFile = projectRootFile;
  }
  let projectRoot = path.dirname(projectRootFile);

  let outputCwd = outputFS.cwd();
  let cacheDir =
    // If a cacheDir is provided, resolve it relative to cwd. Otherwise,
    // use a default directory resolved relative to the project root.
    initialOptions.cacheDir != null
      ? path.resolve(outputCwd, initialOptions.cacheDir)
      : path.resolve(projectRoot, DEFAULT_CACHE_DIRNAME);

  let targetResolver = new TargetResolver(inputFS);
  let targets = await targetResolver.resolve(rootDir, cacheDir, initialOptions);

  // $FlowFixMe
  return {
    env:
      initialOptions.env ??
      (await loadDotEnv(inputFS, path.join(rootDir, 'index'))),
    ...initialOptions,
    cacheDir,
    entries,
    rootDir,
    targets,
    sourceMaps: initialOptions.sourceMaps ?? true,
    scopeHoist:
      initialOptions.scopeHoist ?? initialOptions.mode === 'production',
    logLevel: initialOptions.logLevel ?? 'info',
    projectRoot,
    lockFile,
    inputFS,
    outputFS
  };
}
