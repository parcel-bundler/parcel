// @flow
import type {EnvironmentOpts} from '@parcel/types';
import type {Environment} from './types';
import {md5FromOrderedObject} from '@parcel/utils';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0',
};

export const envCache = new Map<string, Environment>();
//key: a4115e2a10742b469ad164abba6c75d8-${context} value: Environment

// export const clearCache = () => {
//   envCache.clear();
// };

export function createEnvironment({
  context,
  engines, //  object here. perhaps we could only compare equality of objs
  includeNodeModules, // obj
  outputFormat,
  minify = false,
  isLibrary = false,
  scopeHoist = false,
  sourceMap, //obj
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
  // hash based on everything BUT id? Map<everythingExceptID, envID>
  // IDEA: Map<[EnvID, context], Environment> <-- have to first compute the ID (i.e., getEnvironmentHash)

  let id = getEnvironmentHash(res);
  let idAndContext = `${id}-${context}`;

  for (const entry of envCache.entries()) {
    // entry: [string, Environment]
    if (entry[0] === idAndContext) {
      // res.id = entry[1];
      // console.log('getting', res, 'from cache:', envCache.get(entry[0]));
      // return res;
      //-----------
      // entry[0].id = entry[1];
      // console.log(
      //   'about to return',
      //   entry[0],
      //   'from cache. cache is now:',
      //   envCache,
      // );
      // return entry[0];
      //--------------
      console.log('returning', entry[1], 'from cache');
      return entry[1];
    }
  }

  res.id = id;
  envCache.set(idAndContext, res);
  // Env IDs can be the same but have different fields in res (specifically, context)
  // e.g., in kitchen-sink/test-with-runtransform.txt with Assetgroupid: 304775f6f744bb2676964ece4ad25ee9
  // see comment in getEnvironmentHash

  // But each assetGroupNode ID maps to the same env ID. (see nodeFromAssetGroup in AssetGraph.js)
  // Map<nodeID, Environment>?

  // console.log('cache is now:');
  // for (let i of envCache.entries()) {
  //   console.log(JSON.stringify(i));
  // }
  // console.log('end cache');

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
    scopeHoist: env.scopeHoist,
    sourceMap: env.sourceMap,
  });
}
