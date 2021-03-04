// @flow strict-local

import type {PackageName, ConfigResult} from '@parcel/types';
import {md5FromString} from '@parcel/utils';
import {createEnvironment} from './Environment';
import type {
  Config,
  Environment,
  InternalFileCreateInvalidation,
  InternalDevDepOptions,
} from './types';
import {type ProjectPath, fromProjectPathRelative} from './projectPath';

type ConfigOpts = {|
  plugin: PackageName,
  searchPath: ProjectPath,
  isSource?: boolean,
  env?: Environment,
  result?: ConfigResult,
  includedFiles?: Set<ProjectPath>,
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
  includedFiles,
  invalidateOnFileCreate,
  invalidateOnOptionChange,
  devDeps,
  shouldInvalidateOnStartup,
}: ConfigOpts): Config {
  let environment = env ?? createEnvironment();
  return {
    id: md5FromString(
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
    includedFiles: includedFiles ?? new Set(),
    invalidateOnFileCreate: invalidateOnFileCreate ?? [],
    invalidateOnOptionChange: invalidateOnOptionChange ?? new Set(),
    devDeps: devDeps ?? [],
    shouldInvalidateOnStartup: shouldInvalidateOnStartup ?? false,
  };
}
