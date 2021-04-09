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
import {createEnvironment} from './Environment';

type ConfigOpts = {|
  plugin: PackageName,
  searchPath: FilePath,
  isSource?: boolean,
  env?: Environment,
  result?: ConfigResult,
  includedFiles?: Set<FilePath>,
  invalidateOnFileCreate?: Array<FileCreateInvalidation>,
  invalidateOnOptionChange?: Set<string>,
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
  invalidateOnOptionChange,
  devDeps,
  shouldInvalidateOnStartup,
}: ConfigOpts): Config {
  let environment = env ?? createEnvironment();
  return {
    id: md5FromString(plugin + searchPath + environment.id + String(isSource)),
    isSource: isSource ?? false,
    searchPath,
    env: environment,
    result: result ?? null,
    resultHash: null,
    includedFiles: includedFiles ?? new Set(),
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    invalidateOnOptionChange: invalidateOnOptionChange ?? new Set(),
    devDeps: devDeps ?? [],
    shouldInvalidateOnStartup: shouldInvalidateOnStartup ?? false,
  };
}
