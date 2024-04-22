// @flow
import type {
  EnvironmentOptions,
  Environment as IEnvironment,
  FilePath,
} from '@parcel/types';
import type {Environment, InternalSourceLocation} from './types';
import {hashString} from '@parcel/rust';
import {toInternalSourceLocation} from './utils';
import PublicEnvironment from './public/Environment';
import {environmentToInternalEnvironment} from './public/Environment';
import {
  EnvironmentContext,
  EnvironmentContextNames,
  EnvironmentFlags,
  OutputFormat,
  OutputFormatNames,
  SourceType,
  SourceTypeNames,
} from './types';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0',
};

type EnvironmentOpts = {|
  ...EnvironmentOptions,
  loc?: ?InternalSourceLocation,
|};

export function createEnvironment({
  context,
  engines,
  includeNodeModules,
  outputFormat,
  sourceType = 'module',
  shouldOptimize = false,
  isLibrary = false,
  shouldScopeHoist = false,
  sourceMap,
  loc,
}: EnvironmentOpts = {
  /*::...null*/
}): Environment {
  if (context == null) {
    if (engines?.node) {
      context = 'node';
    } else if (engines?.browsers) {
      context = 'browser';
    } else {
      context = 'browser';
    }
  }

  if (engines == null) {
    switch (context) {
      case 'node':
      case 'electron-main':
        engines = {
          node: DEFAULT_ENGINES.node,
        };
        break;
      case 'browser':
      case 'web-worker':
      case 'service-worker':
      case 'electron-renderer':
        engines = {
          browsers: DEFAULT_ENGINES.browsers,
        };
        break;
      default:
        engines = {};
    }
  }

  if (includeNodeModules == null) {
    switch (context) {
      case 'node':
      case 'electron-main':
      case 'electron-renderer':
        includeNodeModules = false;
        break;
      case 'browser':
      case 'web-worker':
      case 'service-worker':
      default:
        includeNodeModules = true;
        break;
    }
  }

  if (outputFormat == null) {
    switch (context) {
      case 'node':
      case 'electron-main':
      case 'electron-renderer':
        outputFormat = 'commonjs';
        break;
      default:
        outputFormat = 'global';
        break;
    }
  }

  let flags =
    (isLibrary ? EnvironmentFlags.IS_LIBRARY : 0) |
    (shouldOptimize ? EnvironmentFlags.SHOULD_OPTIMIZE : 0) |
    (shouldScopeHoist ? EnvironmentFlags.SHOULD_SCOPE_HOIST : 0);

  let res: Environment = {
    id: '',
    context: EnvironmentContext[context],
    engines,
    includeNodeModules,
    outputFormat: OutputFormat[outputFormat],
    sourceType: SourceType[sourceType],
    flags,
    sourceMap,
    loc,
  };

  res.id = getEnvironmentHash(res);
  return res;
}

export function mergeEnvironments(
  projectRoot: FilePath,
  a: Environment,
  b: ?(EnvironmentOptions | IEnvironment),
): Environment {
  // If merging the same object, avoid copying.
  if (a === b || !b) {
    return a;
  }

  if (b instanceof PublicEnvironment) {
    return environmentToInternalEnvironment(b);
  }

  // $FlowFixMe - ignore the `id` that is already on a
  return createEnvironment({
    ...a,
    context: EnvironmentContextNames[a.context],
    outputFormat: OutputFormatNames[a.outputFormat],
    sourceType: SourceTypeNames[a.sourceType],
    isLibrary: Boolean(a.flags & EnvironmentFlags.IS_LIBRARY),
    shouldOptimize: Boolean(a.flags & EnvironmentFlags.SHOULD_OPTIMIZE),
    shouldScopeHoist: Boolean(a.flags & EnvironmentFlags.SHOULD_SCOPE_HOIST),
    ...b,
    loc: b.loc ? toInternalSourceLocation(projectRoot, b.loc) : a.loc,
  });
}

function getEnvironmentHash(env: Environment): string {
  return hashString(
    JSON.stringify([
      env.context,
      env.engines,
      env.includeNodeModules,
      env.outputFormat,
      env.sourceType,
      env.flags,
      env.sourceMap,
    ]),
  );
}
