// @flow
import type {
  FilePath,
  Meta,
  DependencySpecifier,
  SourceLocation,
  Symbol,
  BundleBehavior as IBundleBehavior,
  SemverRange,
} from '@parcel/types';
import type {
  ParcelDb,
  DependencyAddr,
  EnvironmentAddr,
  TargetAddr,
  AssetAddr,
} from '@parcel/rust';
import {hashString} from '@parcel/rust';
import {SpecifierType, Priority, ExportsCondition} from './types';

import {toDbSourceLocation} from './utils';
import {toProjectPath} from './projectPath';
import {
  Dependency as DbDependency,
  DependencyFlags,
  SymbolFlags,
  Asset as DbAsset,
} from '@parcel/rust';

export type DependencyOpts = {|
  id?: number,
  sourcePath?: FilePath,
  sourceAssetId?: AssetAddr,
  specifier: DependencySpecifier,
  specifierType: $Keys<typeof SpecifierType>,
  priority?: $Keys<typeof Priority>,
  needsStableName?: boolean,
  bundleBehavior?: ?IBundleBehavior,
  isEntry?: boolean,
  isOptional?: boolean,
  loc?: SourceLocation,
  env: EnvironmentAddr,
  packageConditions?: Array<string>,
  meta?: Meta,
  resolveFrom?: FilePath,
  range?: SemverRange,
  target?: TargetAddr,
  symbols?: ?$ReadOnlyMap<
    Symbol,
    {|local: Symbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|},
  >,
  pipeline?: ?string,
|};

export function dependencyId(db: ParcelDb, opts: DependencyOpts): string {
  return hashString(
    (opts.sourceAssetId != null ? DbAsset.get(db, opts.sourceAssetId).id : '') +
      opts.specifier +
      String(opts.env) +
      (opts.target != null ? String(opts.target) : '') +
      (opts.pipeline ?? '') +
      opts.specifierType +
      (opts.bundleBehavior ?? '') +
      (opts.priority ?? 'sync') +
      (opts.packageConditions ? JSON.stringify(opts.packageConditions) : ''),
  );
}

export function createDependency(
  db: ParcelDb,
  projectRoot: FilePath,
  opts: DependencyOpts,
): DependencyAddr {
  // let id =
  //   opts.id ||
  //   hashString(
  //     (opts.sourceAssetId ?? '') +
  //       opts.specifier +
  //       String(opts.env) +
  //       (opts.target ? JSON.stringify(opts.target) : '') +
  //       (opts.pipeline ?? '') +
  //       opts.specifierType +
  //       (opts.bundleBehavior ?? '') +
  //       (opts.priority ?? 'sync') +
  //       (opts.packageConditions ? JSON.stringify(opts.packageConditions) : ''),
  //   );

  // let dep: Dependency = {
  //   id,
  //   specifier: opts.specifier,
  //   specifierType: SpecifierType[opts.specifierType],
  //   priority: Priority[opts.priority ?? 'sync'],
  //   needsStableName: opts.needsStableName ?? false,
  //   bundleBehavior: opts.bundleBehavior
  //     ? BundleBehavior[opts.bundleBehavior]
  //     : null,
  //   isEntry: opts.isEntry ?? false,
  //   isOptional: opts.isOptional ?? false,
  //   loc: toInternalSourceLocation(projectRoot, opts.loc),
  //   env: opts.env,
  //   meta: opts.meta || {},
  //   target: opts.target,
  //   sourceAssetId: opts.sourceAssetId,
  //   sourcePath: toProjectPath(projectRoot, opts.sourcePath),
  //   resolveFrom: toProjectPath(projectRoot, opts.resolveFrom),
  //   range: opts.range,
  //   symbols:
  //     opts.symbols &&
  //     new Map(
  //       [...opts.symbols].map(([k, v]) => [
  //         k,
  //         {
  //           local: v.local,
  //           meta: v.meta,
  //           isWeak: v.isWeak,
  //           loc: toInternalSourceLocation(projectRoot, v.loc),
  //         },
  //       ]),
  //     ),
  //   pipeline: opts.pipeline,
  // };

  let d = new DbDependency(db);
  d.id = opts.id ?? db.getStringId(dependencyId(db, opts));
  d.env = opts.env;
  d.specifier = opts.specifier;
  d.specifierType = opts.specifierType;
  d.priority = opts.priority ?? 'sync';
  d.bundleBehavior = opts.bundleBehavior || 'none';
  d.flags =
    (opts.isEntry ? DependencyFlags.ENTRY : 0) |
    (opts.isOptional ? DependencyFlags.OPTIONAL : 0) |
    (opts.needsStableName ? DependencyFlags.NEEDS_STABLE_NAME : 0);
  d.resolveFrom = toProjectPath(projectRoot, opts.resolveFrom);
  d.range = opts.range;
  d.placeholder = null;
  d.meta = null;
  d.resolverMeta = null;
  if (opts.meta) {
    let {placeholder, ...meta} = opts.meta;
    if (typeof placeholder === 'string') {
      d.placeholder = placeholder;
    }
    if (Object.keys(meta).length > 0) {
      d.meta = JSON.stringify(meta);
    }
  }
  d.target = opts.target;
  d.loc = toDbSourceLocation(db, projectRoot, opts.loc);
  d.pipeline = opts.pipeline;
  d.promiseSymbol = null;
  d.sourceAssetId = null;
  d.symbols.init();
  d.importAttributes.init();

  let symbols = opts.symbols;
  if (symbols) {
    d.flags |= DependencyFlags.HAS_SYMBOLS;
    d.symbols.reserve(symbols.size);
    for (let [exported, {local, isWeak, loc, meta}] of symbols) {
      let sym = d.symbols.extend();
      sym.exported = db.getStringId(exported);
      sym.local = db.getStringId(local);
      sym.flags =
        (isWeak ? SymbolFlags.IS_WEAK : 0) |
        (meta?.isESM === true ? SymbolFlags.IS_ESM : 0);
      sym.loc = toDbSourceLocation(db, projectRoot, loc);
    }
  }

  d.packageConditions = 0;
  d.customPackageConditions.init();
  if (opts.packageConditions) {
    convertConditions(opts.packageConditions, d);
  }

  // console.log('create dependency', d.addr, d.env)
  return d.addr;
}

export function mergeDependencies(
  db: ParcelDb,
  projectRoot: FilePath,
  a: DependencyAddr,
  b: DependencyOpts,
): void {
  let {
    meta,
    symbols,
    needsStableName,
    isEntry,
    isOptional,
    loc,
    range,
    resolveFrom,
    sourcePath,
    packageConditions,
  } = b;
  let dep = DbDependency.get(db, a);
  if (symbols) {
    for (let [exported, {local, isWeak, loc, meta}] of symbols) {
      let sym = dep.symbols.extend();
      sym.exported = db.getStringId(exported);
      sym.local = db.getStringId(local);
      sym.flags =
        (isWeak ? SymbolFlags.IS_WEAK : 0) |
        (meta?.isESM === true ? SymbolFlags.IS_ESM : 0);
      sym.loc = toDbSourceLocation(db, projectRoot, loc);
    }
  }
  if (needsStableName) {
    dep.flags |= DependencyFlags.NEEDS_STABLE_NAME;
  }
  if (isEntry) {
    dep.flags |= DependencyFlags.ENTRY;
  }
  if (!isOptional) {
    dep.flags &= ~DependencyFlags.OPTIONAL;
  }
  if (meta) {
    let {placeholder, ...otherMeta} = meta;
    if (typeof placeholder === 'string') {
      dep.placeholder = placeholder;
    }
    if (Object.keys(otherMeta).length > 0) {
      dep.meta = JSON.stringify({
        ...(dep.meta != null ? JSON.parse(dep.meta) : null),
        ...otherMeta,
      });
    }
  }
  if (loc) {
    dep.loc = toDbSourceLocation(db, projectRoot, loc);
  }
  if (range) {
    dep.range = range;
  }
  if (resolveFrom || sourcePath) {
    dep.resolveFrom = toProjectPath(projectRoot, resolveFrom ?? sourcePath);
  }
  if (packageConditions) {
    // TODO: filter duplicates?
    convertConditions(packageConditions, dep);
  }
}

function convertConditions(conditions: Array<string>, dep: DbDependency) {
  // Store common package conditions as bit flags to reduce size.
  // Custom conditions are stored as strings.
  for (let condition of conditions) {
    if (ExportsCondition[condition]) {
      dep.packageConditions |= ExportsCondition[condition];
    } else {
      dep.customPackageConditions.push(condition);
    }
  }
}
