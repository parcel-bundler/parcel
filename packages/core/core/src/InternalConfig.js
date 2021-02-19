// @flow strict-local

import type {
  FileCreateInvalidation,
  FilePath,
  PackageName,
  ConfigResult,
  DevDepOptions,
} from '@parcel/types';
import {md5FromString} from '@parcel/utils';
import type {Config, Environment} from './types';

type ConfigOpts = {|
  plugin: PackageName,
  isSource: boolean,
  searchPath: FilePath,
  env: Environment,
  result?: ConfigResult,
  includedFiles?: Set<FilePath>,
  invalidateOnFileCreate?: Array<FileCreateInvalidation>,
  devDeps?: Array<DevDepOptions>,
  shouldInvalidateOnStartup?: boolean,
|};

export function createConfig({
  plugin,
  isSource,
  searchPath,
  env,
  result,
  includedFiles,
  invalidateOnFileCreate,
  devDeps,
  shouldInvalidateOnStartup,
}: ConfigOpts): Config {
  return {
    id: md5FromString(plugin + searchPath + env.id + String(isSource)),
    isSource,
    searchPath,
    env,
    result: result ?? null,
    resultHash: null,
    includedFiles: includedFiles ?? new Set(),
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    devDeps: devDeps ?? [],
    shouldInvalidateOnStartup: shouldInvalidateOnStartup ?? false,
  };
}
