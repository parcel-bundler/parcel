// @flow
import type {EnvironmentOptions} from '@parcel/types';
import type {Environment} from './types';
import {md5FromOrderedObject} from '@parcel/utils';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0',
};

export function createEnvironment({
  context,
  engines,
  includeNodeModules,
  outputFormat,
  shouldOptimize = false,
  isLibrary = false,
  shouldScopeHoist = false,
  sourceMap,
}: EnvironmentOptions = {}): Environment {
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

  let res: Environment = {
    id: '',
    context,
    engines,
    includeNodeModules,
    outputFormat,
    isLibrary,
    shouldOptimize,
    shouldScopeHoist,
    sourceMap,
  };

  res.id = getEnvironmentHash(res);
  return res;
}

export function mergeEnvironments(
  a: Environment,
  b: ?EnvironmentOptions,
): Environment {
  // If merging the same object, avoid copying.
  if (a === b || !b) {
    return a;
  }

  // $FlowFixMe - ignore the `id` that is already on a
  return createEnvironment({
    ...a,
    ...b,
  });
}

function getEnvironmentHash(env: Environment): string {
  // context is excluded from hash so that assets can be shared between e.g. workers and browser.
  // Different engines should be sufficient to distinguish multi-target builds.
  return md5FromOrderedObject({
    engines: env.engines,
    includeNodeModules: env.includeNodeModules,
    outputFormat: env.outputFormat,
    isLibrary: env.isLibrary,
    shouldScopeHoist: env.shouldScopeHoist,
    sourceMap: env.sourceMap,
  });
}
