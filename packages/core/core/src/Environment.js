// @flow
import type {
  EnvironmentOptions,
  Environment as IEnvironment,
  FilePath,
} from '@parcel/types';
import type {InternalSourceLocation} from './types';
import type {ParcelDb, EnvironmentAddr} from '@parcel/rust';
import {toDbSourceLocation, toDbSourceLocationFromInternal} from './utils';
import PublicEnvironment from './public/Environment';
import {environmentToInternalEnvironment} from './public/Environment';
import {
  Environment as DbEnvironment,
  EnvironmentFlags,
  TargetSourceMapOptions,
} from '@parcel/rust';

const DEFAULT_ENGINES = {
  browsers: ['> 0.25%'],
  node: '>= 8.0.0',
};

const DEFAULT_NODE_ENGINES = {
  node: DEFAULT_ENGINES.node,
};

const DEFAULT_BROWSER_ENGINES = {
  browsers: DEFAULT_ENGINES.browsers,
};

const EMPTY_ENGINES = {};

type EnvironmentOpts = {|
  ...EnvironmentOptions,
  loc?: ?InternalSourceLocation,
|};

let tmpEnvironment = Symbol('tmpEnvironment');
let tmpSourceMap = Symbol('tmpSourceMapOptions');
// let lastEngines = null;

export function createEnvironment(
  db: ParcelDb,
  {
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
  },
): EnvironmentAddr {
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
        engines = DEFAULT_NODE_ENGINES;
        break;
      case 'browser':
      case 'web-worker':
      case 'service-worker':
      case 'electron-renderer':
        engines = DEFAULT_BROWSER_ENGINES;
        break;
      default:
        engines = EMPTY_ENGINES;
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

  // let res: Environment = {
  //   id: '',
  //   context,
  //   engines,
  //   includeNodeModules,
  //   outputFormat,
  //   sourceType,
  //   isLibrary,
  //   shouldOptimize,
  //   shouldScopeHoist,
  //   sourceMap,
  //   loc,
  // };

  // res.id = getEnvironmentHash(res);
  db[tmpEnvironment] ??= new DbEnvironment(db);
  let tmp: DbEnvironment = db[tmpEnvironment];
  tmp.context = context;
  tmp.outputFormat = outputFormat;
  tmp.sourceType = sourceType;
  tmp.flags =
    (isLibrary ? EnvironmentFlags.IS_LIBRARY : 0) |
    (shouldOptimize ? EnvironmentFlags.SHOULD_OPTIMIZE : 0) |
    (shouldScopeHoist ? EnvironmentFlags.SHOULD_SCOPE_HOIST : 0);
  tmp.includeNodeModules = JSON.stringify(includeNodeModules);
  // if (engines !== lastEngines) {
  tmp.engines = JSON.stringify(engines);
  // lastEngines = engines;
  // }
  // console.timeEnd('create env')
  if (sourceMap) {
    db[tmpSourceMap] ??= new TargetSourceMapOptions(db);
    let s: TargetSourceMapOptions = db[tmpSourceMap];
    s.sourceRoot = sourceMap.sourceRoot;
    s.inline = !!sourceMap.inline;
    s.inlineSources = !!sourceMap.inlineSources;
    tmp.sourceMap = s;
  } else {
    tmp.sourceMap = null;
  }

  tmp.loc = toDbSourceLocationFromInternal(db, loc);
  // console.log('env', tmp, tmp.context, tmp.outputFormat, tmp.sourceType, tmp.flags);

  let res = db.createEnvironment(tmp.addr);
  // console.log(res, tmp.context)

  return res;
}

export function mergeEnvironments(
  db: ParcelDb,
  projectRoot: FilePath,
  a: EnvironmentAddr,
  b: ?(EnvironmentOptions | IEnvironment),
): EnvironmentAddr {
  // If merging the same object, avoid copying.
  if (a === b || !b) {
    return a;
  }

  if (b instanceof PublicEnvironment) {
    return environmentToInternalEnvironment(b);
  }

  db[tmpEnvironment] ??= new DbEnvironment(db);
  let tmp = db[tmpEnvironment];

  let env = DbEnvironment.get(db, a);
  DbEnvironment.set(db, tmp.addr, env);

  if (b.context) {
    tmp.context = b.context;
  }

  if (b.outputFormat) {
    tmp.outputFormat = b.outputFormat;
  }

  if (b.sourceType) {
    tmp.sourceType = b.sourceType;
  }

  tmp.flags =
    mergeFlag(env.flags, EnvironmentFlags.IS_LIBRARY, b.isLibrary) |
    mergeFlag(env.flags, EnvironmentFlags.SHOULD_OPTIMIZE, b.shouldOptimize) |
    mergeFlag(
      env.flags,
      EnvironmentFlags.SHOULD_SCOPE_HOIST,
      b.shouldScopeHoist,
    );

  if (b.includeNodeModules) {
    tmp.includeNodeModules = JSON.stringify(b.includeNodeModules);
  }

  if (b.engines) {
    // if (b.engines !== lastEngines) {
    tmp.engines = JSON.stringify(b.engines);
    // lastEngines = b.engines;
    // }
  }

  if (b.loc) {
    tmp.loc = toDbSourceLocation(db, projectRoot, b.loc);
  }

  // TODO: sourceMap

  return db.createEnvironment(tmp.addr);
}

function mergeFlag(cur: number, flag: number, value: ?boolean) {
  return value == null ? cur & flag : value ? flag : 0;
}

// function getEnvironmentHash(env: Environment): string {
//   return hashString(
//     JSON.stringify([
//       env.context,
//       env.engines,
//       env.includeNodeModules,
//       env.outputFormat,
//       env.sourceType,
//       env.isLibrary,
//       env.shouldOptimize,
//       env.shouldScopeHoist,
//       env.sourceMap,
//     ]),
//   );
// }
