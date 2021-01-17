// @flow strict-local

import type {
  FileCreateInvalidation,
  FilePath,
  PackageName,
  ConfigResult,
} from '@parcel/types';
import type {Config, Environment} from './types';

type ConfigOpts = {|
  isSource: boolean,
  searchPath: FilePath,
  env: Environment,
  result?: ConfigResult,
  includedFiles?: Set<FilePath>,
  invalidateOnFileCreate?: Array<FileCreateInvalidation>,
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
  invalidateOnFileCreate,
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
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    pkg: null,
    pkgFilePath: null,
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
