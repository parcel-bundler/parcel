// @flow strict-local

import type {PackageName, ConfigResult} from '@parcel/types';
import type {
  Config,
  InternalFileCreateInvalidation,
  InternalDevDepOptions,
} from './types';
import type {ProjectPath} from './projectPath';
import type {ParcelDb, EnvironmentAddr} from '@parcel/rust';

import {fromProjectPathRelative} from './projectPath';
import {createEnvironment} from './Environment';
import {hashString} from '@parcel/rust';

type ConfigOpts = {|
  db: ParcelDb,
  plugin: PackageName,
  searchPath: ProjectPath,
  isSource?: boolean,
  env?: EnvironmentAddr,
  result?: ConfigResult,
  invalidateOnFileChange?: Set<ProjectPath>,
  invalidateOnConfigKeyChange?: Array<{|
    filePath: ProjectPath,
    configKey: string,
  |}>,
  invalidateOnFileCreate?: Array<InternalFileCreateInvalidation>,
  invalidateOnEnvChange?: Set<string>,
  invalidateOnOptionChange?: Set<string>,
  devDeps?: Array<InternalDevDepOptions>,
  invalidateOnStartup?: boolean,
  invalidateOnBuild?: boolean,
|};

export function createConfig({
  db,
  plugin,
  isSource,
  searchPath,
  env,
  result,
  invalidateOnFileChange,
  invalidateOnConfigKeyChange,
  invalidateOnFileCreate,
  invalidateOnEnvChange,
  invalidateOnOptionChange,
  devDeps,
  invalidateOnStartup,
  invalidateOnBuild,
}: ConfigOpts): Config {
  let environment = env ?? createEnvironment(db);
  return {
    id: hashString(
      plugin +
        fromProjectPathRelative(searchPath) +
        String(environment) +
        String(isSource),
    ),
    isSource: isSource ?? false,
    searchPath,
    env: environment,
    result: result ?? null,
    cacheKey: null,
    invalidateOnFileChange: invalidateOnFileChange ?? new Set(),
    invalidateOnConfigKeyChange: invalidateOnConfigKeyChange ?? [],
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    invalidateOnEnvChange: invalidateOnEnvChange ?? new Set(),
    invalidateOnOptionChange: invalidateOnOptionChange ?? new Set(),
    devDeps: devDeps ?? [],
    invalidateOnStartup: invalidateOnStartup ?? false,
    invalidateOnBuild: invalidateOnBuild ?? false,
  };
}
