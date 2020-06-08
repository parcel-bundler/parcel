// @flow strict-local

import type {FilePath, Glob, PackageName, ConfigResult} from '@parcel/types';
import type {Config, Environment} from './types';

type ConfigOpts = {|
  isSource: boolean,
  searchPath: FilePath,
  env: Environment,
  result?: ConfigResult,
  includedFiles?: Set<FilePath>,
  watchGlob?: Glob,
  devDeps?: Map<PackageName, ?string>,
  shouldRehydrate?: boolean,
  shouldReload?: boolean,
  shouldInvalidateOnStartup?: boolean,
|};

export function createConfig({
  isSource,
  searchPath,
  env,
  result,
  includedFiles,
  watchGlob,
  devDeps,
  shouldRehydrate,
  shouldReload,
  shouldInvalidateOnStartup,
}: ConfigOpts): Config {
  return {
    isSource,
    searchPath,
    env,
    result: result ?? null,
    resultHash: null,
    includedFiles: includedFiles ?? new Set(),
    pkg: null,
    pkgFilePath: null,
    watchGlob,
    devDeps: devDeps ?? new Map(),
    shouldRehydrate: shouldRehydrate ?? false,
    shouldReload: shouldReload ?? false,
    shouldInvalidateOnStartup: shouldInvalidateOnStartup ?? false,
  };
}

export function addDevDependency(
  config: Config,
  name: PackageName,
  version?: string,
) {
  config.devDeps.set(name, version);
}

// TODO: start using edge types for more flexible invalidations
export function getInvalidations(config: Config) {
  let invalidations = [];

  if (config.watchGlob != null) {
    invalidations.push({
      action: 'add',
      pattern: config.watchGlob,
    });
  }

  for (let filePath of config.includedFiles) {
    invalidations.push({
      action: 'change',
      pattern: filePath,
    });

    invalidations.push({
      action: 'unlink',
      pattern: filePath,
    });
  }

  return invalidations;
}
