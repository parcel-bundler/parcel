// @flow
import type {
  EnvironmentOptions,
  Environment as IEnvironment,
  FilePath,
  Engines,
} from '@parcel/types';
import type {InternalSourceLocation} from './types';
import type {
  ParcelDb,
  EnvironmentAddr,
  Engines as DbEngines,
} from '@parcel/rust';
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

function initTmpEnvironment(db: ParcelDb): DbEnvironment {
  if (!db[tmpEnvironment]) {
    db[tmpEnvironment] = new DbEnvironment(db);
    db[tmpEnvironment].engines.browsers.init();
  }
  return db[tmpEnvironment];
}

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

  let tmp: DbEnvironment = initTmpEnvironment(db);
  tmp.context = context;
  tmp.outputFormat = outputFormat;
  tmp.sourceType = sourceType;
  tmp.flags =
    (isLibrary ? EnvironmentFlags.IS_LIBRARY : 0) |
    (shouldOptimize ? EnvironmentFlags.SHOULD_OPTIMIZE : 0) |
    (shouldScopeHoist ? EnvironmentFlags.SHOULD_SCOPE_HOIST : 0);
  tmp.includeNodeModules = JSON.stringify(includeNodeModules);
  setEngines(tmp.engines, engines);

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

  return db.createEnvironment(tmp.addr);
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

  let tmp = initTmpEnvironment(db);
  let env = DbEnvironment.get(db, a);

  tmp.context = b.context || env.context;
  tmp.outputFormat = b.outputFormat || env.outputFormat;
  tmp.sourceType = b.sourceType || env.sourceType;

  tmp.flags =
    mergeFlag(env.flags, EnvironmentFlags.IS_LIBRARY, b.isLibrary) |
    mergeFlag(env.flags, EnvironmentFlags.SHOULD_OPTIMIZE, b.shouldOptimize) |
    mergeFlag(
      env.flags,
      EnvironmentFlags.SHOULD_SCOPE_HOIST,
      b.shouldScopeHoist,
    );

  tmp.includeNodeModules = b.includeNodeModules
    ? JSON.stringify(b.includeNodeModules)
    : env.includeNodeModules;

  if (b.engines) {
    setEngines(tmp.engines, b.engines);
  } else {
    tmp.engines.browsers.copyFrom(env.engines.browsers);
    tmp.engines.electron = env.engines.electron;
    tmp.engines.node = env.engines.node;
    tmp.engines.parcel = env.engines.parcel;
  }

  tmp.loc = b.loc ? toDbSourceLocation(db, projectRoot, b.loc) : env.loc;

  if (b.sourceMap) {
    db[tmpSourceMap] ??= new TargetSourceMapOptions(db);
    let s: TargetSourceMapOptions = db[tmpSourceMap];
    s.sourceRoot = b.sourceMap?.sourceRoot;
    s.inline = !!b.sourceMap?.inline;
    s.inlineSources = !!b.sourceMap?.inlineSources;
    tmp.sourceMap = s;
  } else {
    tmp.sourceMap = env.sourceMap;
  }

  return db.createEnvironment(tmp.addr);
}

function mergeFlag(cur: number, flag: number, value: ?boolean) {
  return value == null ? cur & flag : value ? flag : 0;
}

function setEngines(engines: DbEngines, options: ?Engines) {
  engines.browsers.clear();
  if (options) {
    if (Array.isArray(options.browsers)) {
      for (let browser of options.browsers) {
        engines.browsers.push(browser);
      }
    } else if (typeof options.browsers === 'string') {
      engines.browsers.push(options.browsers);
    }

    engines.electron = options.electron;
    engines.node = options.node;
    engines.parcel = options.parcel;
  } else {
    engines.electron = null;
    engines.node = null;
    engines.parcel = null;
  }
}
