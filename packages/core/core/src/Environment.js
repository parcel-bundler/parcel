// @flow
import type {EnvironmentOpts} from '@parcel/types';
import type {Environment} from './types';
import {md5FromOrderedObject} from '@parcel/utils';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0',
};

export const envCache = new Map<Environment, string>();
//key: a4115e2a10742b469ad164abba6c75d8-${context} value: Environment

// export const clearCache = () => {
//   envCache.clear();
// };

export function createEnvironment({
  context,
  engines,
  includeNodeModules,
  outputFormat,
  minify = false,
  isLibrary = false,
  scopeHoist = false,
  sourceMap,
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
    minify,
    scopeHoist,
    sourceMap,
  };

  // let res2: Environment = {
  //   id: '',
  //   context,
  //   engines,
  //   includeNodeModules,
  //   outputFormat,
  //   isLibrary,
  //   minify,
  //   scopeHoist,
  //   sourceMap,
  // };

  // hash based on everything BUT id? Map<everythingExceptID, envID>

  // for (const entry of envCache.entries()) {
  //   // entry: [Environment, id]
  //   if (deepEqual(entry[0], res)) {
  //     res.id = entry[1];
  //     console.log('getting', res, 'from cache:', envCache.get(entry[0]));
  //     return res;
  //   }
  // }

  // map each assetgroupNode ID to envID-context?

  //res.id = getEnvironmentHash(res); // <-- this is expensive
  let id = getEnvironmentHash(res);
  //envCache.set(res2, id);
  // Env IDs can be the same but have different fields in res (specifically, context)
  // e.g., in kitchen-sink/test-with-runtransform.txt with assetgroupid: 304775f6f744bb2676964ece4ad25ee9
  // see comment in getEnvironmentHash

  // But each assetGroupNode ID maps to the same env ID.

  // Map<nodeID, Environment>
  // NOT THIS envCache.set(nodeId, res);

  //console.log('cache is now:', envCache);

  res.id = id;

  return res;
}

function deepEqual(object1, object2) {
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    const val1 = object1[key];
    const val2 = object2[key];
    const areObjects = isObject(val1) && isObject(val2);
    if (
      (areObjects && !deepEqual(val1, val2)) ||
      (!areObjects && val1 !== val2)
    ) {
      return false;
    }
  }

  return true;
}

function isObject(object) {
  return object != null && typeof object === 'object';
}

export function mergeEnvironments(
  a: Environment,
  b: ?EnvironmentOpts,
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
    scopeHoist: env.scopeHoist,
    sourceMap: env.sourceMap,
  });
}
