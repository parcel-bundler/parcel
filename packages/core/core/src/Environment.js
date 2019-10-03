// @flow
import type {EnvironmentOpts} from '@parcel/types';
import type {Environment} from './types';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0'
};

export function createEnvironment({
  context,
  engines,
  includeNodeModules,
  outputFormat,
  isLibrary = false
}: EnvironmentOpts = {}): Environment {
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
          node: DEFAULT_ENGINES.node
        };
        break;
      case 'browser':
      case 'web-worker':
      case 'service-worker':
      case 'electron-renderer':
        engines = {
          browsers: DEFAULT_ENGINES.browsers
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

  return {
    context,
    engines,
    includeNodeModules,
    outputFormat,
    isLibrary
  };
}

export function mergeEnvironments(
  a: Environment,
  b: ?EnvironmentOpts
): Environment {
  // If merging the same object, avoid copying.
  if (a === b) {
    return a;
  }

  return createEnvironment({
    ...a,
    ...b
  });
}
