// @flow strict-local

import type {PackageName, ConfigResult} from '@parcel/types';
import type {
  Config,
  Environment,
  InternalFileCreateInvalidation,
  InternalDevDepOptions,
} from './types';
import type {ProjectPath} from './projectPath';

import {fromProjectPathRelative} from './projectPath';
import {createEnvironment} from './Environment';
import {hashString} from '@parcel/hash';

type ConfigOpts = {|
  plugin: PackageName,
  searchPath: ProjectPath,
  isSource?: boolean,
  env?: Environment,
  result?: ConfigResult,
  invalidateOnFileChange?: Set<ProjectPath>,
  invalidateOnFileCreate?: Array<InternalFileCreateInvalidation>,
  invalidateOnOptionChange?: Set<string>,
  devDeps?: Array<InternalDevDepOptions>,
  shouldInvalidateOnStartup?: boolean,
|};

export function createConfig({
  plugin,
  isSource,
  searchPath,
  env,
  result,
  invalidateOnFileChange,
  invalidateOnFileCreate,
  invalidateOnOptionChange,
  devDeps,
  shouldInvalidateOnStartup,
}: ConfigOpts): Config {
  let environment = env ?? createEnvironment();
  return {
    id: hashString(
      plugin +
        fromProjectPathRelative(searchPath) +
        environment.id +
        String(isSource),
    ),
    isSource: isSource ?? false,
    searchPath,
    env: environment,
    result: result ?? null,
    resultHash: null,
    invalidateOnFileChange: invalidateOnFileChange ?? new Set(),
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    invalidateOnOptionChange: invalidateOnOptionChange ?? new Set(),
    devDeps: devDeps ?? [],
    shouldInvalidateOnStartup: shouldInvalidateOnStartup ?? false,
  };
}
