// @flow strict-local

import type {
  FileCreateInvalidation,
  FilePath,
  PackageName,
  ConfigResult,
  DevDepOptions,
} from '@parcel/types';
import type {Config, Environment} from './types';
import {createEnvironment} from './Environment';
import {hashString} from '@parcel/hash';

type ConfigOpts = {|
  plugin: PackageName,
  searchPath: FilePath,
  isSource?: boolean,
  env?: Environment,
  result?: ConfigResult,
  invalidateOnFileChange?: Set<FilePath>,
  invalidateOnFileCreate?: Array<FileCreateInvalidation>,
  invalidateOnEnvChange?: Set<string>,
  invalidateOnOptionChange?: Set<string>,
  devDeps?: Array<DevDepOptions>,
  invalidateOnStartup?: boolean,
|};

export function createConfig({
  plugin,
  isSource,
  searchPath,
  env,
  result,
  invalidateOnFileChange,
  invalidateOnFileCreate,
  invalidateOnEnvChange,
  invalidateOnOptionChange,
  devDeps,
  invalidateOnStartup,
}: ConfigOpts): Config {
  let environment = env ?? createEnvironment();
  return {
    id: hashString(plugin + searchPath + environment.id + String(isSource)),
    isSource: isSource ?? false,
    searchPath,
    env: environment,
    result: result ?? null,
    cacheKey: null,
    invalidateOnFileChange: invalidateOnFileChange ?? new Set(),
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    invalidateOnEnvChange: invalidateOnEnvChange ?? new Set(),
    invalidateOnOptionChange: invalidateOnOptionChange ?? new Set(),
    devDeps: devDeps ?? [],
    invalidateOnStartup: invalidateOnStartup ?? false,
  };
}
